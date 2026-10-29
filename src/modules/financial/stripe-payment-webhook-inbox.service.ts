import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  IntegrationConnectionStatus, IntegrationEnvironment, IntegrationScope, Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';
import { IntegrationSecretResolverService } from '../integrations/secrets/integration-secret-resolver.service';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_SIGNATURE_AGE_SECONDS = 300;

export function verifyStripeWebhookSignature(
  raw: Buffer,
  signatureHeader: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): void {
  if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > MAX_BODY_BYTES ||
      typeof signatureHeader !== 'string' || signatureHeader.length > 2048 ||
      typeof secret !== 'string' || !secret.startsWith('whsec_')) {
    throw new ForbiddenException('WEBHOOK_SIGNATURE_INVALID');
  }
  const values = signatureHeader.split(',').map((piece) => piece.trim());
  const timestampField = values.find((part) => part.startsWith('t='));
  const timestampText = timestampField?.slice(2) ?? '';
  if (!/^\d{10,13}$/.test(timestampText)) {
    throw new ForbiddenException('WEBHOOK_SIGNATURE_INVALID');
  }
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) ||
      Math.abs(nowSeconds - timestamp) > MAX_SIGNATURE_AGE_SECONDS) {
    throw new ForbiddenException('WEBHOOK_SIGNATURE_EXPIRED');
  }
  const signatures = values.filter((part) => /^v1=[a-fA-F0-9]{64}$/.test(part))
    .map((part) => Buffer.from(part.slice(3), 'hex'));
  if (!signatures.length) throw new ForbiddenException('WEBHOOK_SIGNATURE_INVALID');
  const expected = createHmac('sha256', secret)
    .update(String(timestamp)).update('.').update(raw).digest();
  if (!signatures.some((actual) => actual.length === expected.length &&
      timingSafeEqual(actual, expected))) {
    throw new ForbiddenException('WEBHOOK_SIGNATURE_INVALID');
  }
}

@Injectable()
export class StripePaymentWebhookInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly secrets: IntegrationSecretResolverService,
    private readonly audit: AuditService,
  ) {}

  async ingest(connectionId: string, signature: string, rawBody?: Buffer) {
    if (!rawBody || !Buffer.isBuffer(rawBody) ||
        rawBody.length === 0 || rawBody.length > MAX_BODY_BYTES) {
      throw new BadRequestException('WEBHOOK_RAW_BODY_REQUIRED');
    }
    const environment = this.runtime.current() as IntegrationEnvironment;
    const connection = await this.prisma.integrationConnection.findFirst({
      where: {
        id: connectionId,
        scope: IntegrationScope.TENANT,
        providerCode: 'stripe_webhook',
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
      throw new NotFoundException('WEBHOOK_CONNECTION_NOT_AVAILABLE');
    }
    const signingSecret = await this.secrets.resolveForExternalBoundary(
      connection.id,
      { scope: 'TENANT', gymId: connection.gymId },
    );
    verifyStripeWebhookSignature(rawBody, signature, signingSecret.reveal());
    let parsed: unknown;
    try { parsed = JSON.parse(rawBody.toString('utf8')); } catch {
      throw new BadRequestException('WEBHOOK_EVENT_INVALID');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('WEBHOOK_EVENT_INVALID');
    }
    const event = parsed as Record<string, any>;
    if (typeof event.id !== 'string' ||
        !/^evt_[A-Za-z0-9_]{1,220}$/.test(event.id) ||
        typeof event.type !== 'string' || event.type.length > 128 ||
        typeof event.livemode !== 'boolean' ||
        event.livemode !== (environment === 'PROD') ||
        !event.data || !event.data.object || typeof event.data.object !== 'object') {
      throw new BadRequestException('WEBHOOK_EVENT_INVALID');
    }
    const object = event.data.object as Record<string, unknown>;
    const providerObjectRef = typeof object.id === 'string' &&
      object.id.length <= 255 ? object.id : null;
    let chargeId: string | null = null;
    let status = 'UNMATCHED';
    if (event.type.startsWith('checkout.session.') && providerObjectRef) {
      const matched = await this.prisma.charge.findFirst({
        where: {
          gymId: connection.gymId,
          gatewayProviderCode: 'stripe',
          gatewayChargeId: providerObjectRef,
        },
        select: { id: true },
      });
      if (matched) {
        chargeId = matched.id;
        status = 'RECEIVED';
      }
    }
    const data = {
      gymId: connection.gymId,
      connectionId: connection.id,
      providerCode: 'stripe',
      providerEventId: event.id,
      eventType: event.type,
      providerObjectRef,
      chargeId,
      status,
    };
    try {
      const entry = await this.prisma.tenantPaymentWebhookInbox.create({ data });
      await this.audit.record({
        gymId: connection.gymId,
        userId: null,
        action: 'FINANCIAL_STRIPE_SIGNED_WEBHOOK_RECEIVED',
        entity: 'TenantPaymentWebhookInbox',
        entityId: entry.id,
        next: { providerEventId: event.id, eventType: event.type, status, chargeId },
      });
      return { received: true, duplicate: false, status };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      return { received: true, duplicate: true, status: 'DUPLICATE' };
    }
  }

  async listForGym(gymId: string) {
    return this.prisma.tenantPaymentWebhookInbox.findMany({
      where: { gymId },
      orderBy: { receivedAt: 'desc' },
      take: 100,
      select: {
        id: true, providerCode: true, providerEventId: true, eventType: true,
        providerObjectRef: true, chargeId: true, status: true, receivedAt: true,
      },
    });
  }
}
