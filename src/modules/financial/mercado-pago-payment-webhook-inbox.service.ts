import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  IntegrationConnectionStatus, IntegrationEnvironment, IntegrationScope, Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';
import { IntegrationSecretResolverService } from '../integrations/secrets/integration-secret-resolver.service';

export function verifyMercadoPagoWebhookSignature(
  header: string,
  requestId: string,
  dataId: string,
  secret: string,
  nowMillis = Date.now(),
): void {
  if (typeof header !== 'string' || header.length > 2048 ||
      typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 256 ||
      typeof dataId !== 'string' || !/^\d{1,35}$/.test(dataId) ||
      typeof secret !== 'string' || secret.length < 8) {
    throw new ForbiddenException('MP_WEBHOOK_SIGNATURE_INVALID');
  }
  const fields = header.split(',').map((part) => part.trim());
  const ts = fields.find((part) => part.startsWith('ts='))?.slice(3) ?? '';
  if (!/^\d{10,13}$/.test(ts)) throw new ForbiddenException('MP_WEBHOOK_SIGNATURE_INVALID');
  const timestamp = Number(ts);
  if (!Number.isSafeInteger(timestamp)) throw new ForbiddenException('MP_WEBHOOK_SIGNATURE_INVALID');
  const millis = ts.length === 13 ? timestamp : timestamp * 1000;
  if (Math.abs(nowMillis - millis) > 300_000) {
    throw new ForbiddenException('MP_WEBHOOK_SIGNATURE_EXPIRED');
  }
  const expected = createHmac('sha256', secret)
    .update('id:' + dataId.toLowerCase() + ';request-id:' + requestId + ';ts:' + ts + ';')
    .digest();
  const candidates = fields.filter((part) => /^v1=[a-fA-F0-9]{64}$/.test(part));
  if (!candidates.some((part) => {
    const bytes = Buffer.from(part.slice(3), 'hex');
    return bytes.length === expected.length && timingSafeEqual(bytes, expected);
  })) {
    throw new ForbiddenException('MP_WEBHOOK_SIGNATURE_INVALID');
  }
}

@Injectable()
export class MercadoPagoPaymentWebhookInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly secrets: IntegrationSecretResolverService,
    private readonly audit: AuditService,
  ) {}

  async ingest(
    connectionId: string,
    signature: string,
    requestId: string,
    dataId: string,
    rawBody?: Buffer,
  ) {
    if (!Buffer.isBuffer(rawBody) || !rawBody.length || rawBody.length > 256 * 1024) {
      throw new BadRequestException('MP_WEBHOOK_RAW_BODY_REQUIRED');
    }
    const environment = this.runtime.current() as IntegrationEnvironment;
    const connection = await this.prisma.integrationConnection.findFirst({
      where: {
        id: connectionId,
        scope: IntegrationScope.TENANT,
        providerCode: 'mercado_pago_webhook',
        environment,
        status: IntegrationConnectionStatus.ACTIVE,
        secretReference: { not: null },
        secretVersion: { not: null },
        secretRevokedAt: null,
        OR: [{ secretExpiresAt: null }, { secretExpiresAt: { gt: new Date() } }],
      },
    });
    if (!connection?.gymId || connection.authModel !== 'WEBHOOK_SECRET' ||
        !Array.isArray(connection.capabilities) ||
        !connection.capabilities.includes('billing.student.webhook')) {
      throw new NotFoundException('MP_WEBHOOK_CONNECTION_NOT_AVAILABLE');
    }
    const key = await this.secrets.resolveForExternalBoundary(
      connection.id, { scope: 'TENANT', gymId: connection.gymId },
    );
    verifyMercadoPagoWebhookSignature(signature, requestId, dataId, key.reveal());
    let payload: any;
    try { payload = JSON.parse(rawBody.toString('utf8')); } catch {
      throw new BadRequestException('MP_WEBHOOK_EVENT_INVALID');
    }
    const notificationId = payload?.id;
    if ((!Number.isSafeInteger(notificationId) && typeof notificationId !== 'string') ||
        !/^\d{1,35}$/.test(String(notificationId)) ||
        typeof payload.type !== 'string' || payload.type.length > 128 ||
        typeof payload.live_mode !== 'boolean' ||
        payload.live_mode !== (environment === 'PROD') ||
        String(payload.data?.id ?? '') !== dataId) {
      throw new BadRequestException('MP_WEBHOOK_EVENT_INVALID');
    }
    let status = ['payment', 'chargebacks'].includes(payload.type) ? 'UNMATCHED' : 'IGNORED';
    let chargeId: string | null = null;
    // A signed MP webhook says which payment changed, not which academy
    // charge belongs to the merchant. Resolve the merchant credential from
    // a tenant-owned webhook connection and independently verify the payment.
    const config = connection.publicConfiguration;
    const paymentConnectionId = config && typeof config === 'object' &&
      !Array.isArray(config) &&
      typeof (config as Record<string, unknown>).paymentConnectionId === 'string'
      ? (config as Record<string, string>).paymentConnectionId : null;
    if (payload.type === 'payment' && paymentConnectionId) {
      const paymentConnection = await this.prisma.integrationConnection.findFirst({
        where: {
          id: paymentConnectionId,
          gymId: connection.gymId,
          scope: IntegrationScope.TENANT,
          providerCode: 'mercado_pago',
          environment,
          status: IntegrationConnectionStatus.ACTIVE,
          secretReference: { not: null },
          secretVersion: { not: null },
          secretRevokedAt: null,
          OR: [{ secretExpiresAt: null }, { secretExpiresAt: { gt: new Date() } }],
        },
      });
      if (!paymentConnection) throw new NotFoundException('MP_PAYMENT_CONNECTION_NOT_AVAILABLE');
      const merchantSecret = await this.secrets.resolveForExternalBoundary(
        paymentConnection.id, { scope: 'TENANT', gymId: connection.gymId },
      );
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      let payment: Record<string, unknown>;
      try {
        const response = await fetch(
          'https://api.mercadopago.com/v1/payments/' + encodeURIComponent(dataId),
          {
            method: 'GET', redirect: 'error', signal: controller.signal,
            headers: { authorization: 'Bearer ' + merchantSecret.reveal() },
          },
        );
        if (!response.ok) throw new BadRequestException('MP_PAYMENT_LOOKUP_FAILED');
        const raw = await response.text();
        if (Buffer.byteLength(raw, 'utf8') > 65_536) {
          throw new BadRequestException('MP_PAYMENT_RESPONSE_TOO_LARGE');
        }
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new BadRequestException('MP_PAYMENT_RESPONSE_INVALID');
        }
        payment = parsed as Record<string, unknown>;
      } catch {
        throw new BadRequestException('MP_PAYMENT_RECONCILIATION_UNAVAILABLE');
      } finally {
        clearTimeout(timeout);
      }
      if (String(payment.id ?? '') !== dataId || payment.currency_id !== 'BRL') {
        throw new ForbiddenException('MP_WEBHOOK_PAYMENT_MISMATCH');
      }
      const externalReference = payment.external_reference;
      const amount = payment.transaction_amount;
      const cents = typeof amount === 'number' && Number.isFinite(amount)
        ? amount * 100 : NaN;
      if (typeof externalReference === 'string' &&
          /^[a-f0-9-]{36}$/i.test(externalReference) &&
          Number.isFinite(cents) && Math.abs(cents - Math.round(cents)) < 0.000001) {
        const charge = await this.prisma.charge.findFirst({
          where: {
            id: externalReference, gymId: connection.gymId,
            gatewayProviderCode: 'mercado_pago',
            gatewayConnectionId: paymentConnection.id,
            amount: Math.round(cents),
          },
          select: { id: true },
        });
        if (charge) {
          chargeId = charge.id;
          status = 'RECEIVED';
        }
      }
    }
    const eventType = typeof payload.action === 'string' &&
      payload.action.length <= 128 ? payload.action : payload.type;
    try {
      const entry = await this.prisma.tenantPaymentWebhookInbox.create({
        data: {
          gymId: connection.gymId,
          connectionId: connection.id,
          providerCode: 'mercado_pago',
          providerEventId: String(notificationId),
          eventType,
          providerObjectRef: dataId,
          status,
          chargeId,
        },
      });
      await this.audit.record({
        gymId: connection.gymId,
        userId: null,
        action: 'FINANCIAL_MP_SIGNED_WEBHOOK_RECEIVED',
        entity: 'TenantPaymentWebhookInbox',
        entityId: entry.id,
        next: { providerEventId: String(notificationId), eventType, status },
      });
      return { received: true, duplicate: false, status };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      return { received: true, duplicate: true, status: 'DUPLICATE' };
    }
  }
}
