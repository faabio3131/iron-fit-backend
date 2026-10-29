import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ChargeStatus,
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';
import { IntegrationSecretResolverService } from '../integrations/secrets/integration-secret-resolver.service';
import { CreateChargePaymentSessionDto } from './dto/create-charge-payment-session.dto';
import { TenantPaymentProviderAdapterRegistry } from './tenant-payment-provider-adapter';

const TENANT_PAYMENT_CAPABILITY = 'billing.student.checkout';

function hasCapability(raw: unknown, required: string): boolean {
  return (
    Array.isArray(raw) &&
    raw.some(
      (value) =>
        typeof value === 'string' &&
        value.trim().toLowerCase() === required,
    )
  );
}

function safeCheckoutUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.length > 2048) {
    throw new ServiceUnavailableException(
      'Provider retornou checkoutUrl acima do limite',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ServiceUnavailableException(
      'Provider retornou checkoutUrl invalida',
    );
  }
  if (parsed.protocol !== 'https:') {
    throw new ServiceUnavailableException(
      'Provider retornou checkoutUrl sem HTTPS',
    );
  }
  return parsed.toString();
}

function safeProviderRef(raw: string): string {
  const value = raw.trim();
  if (!value || value.length > 512) {
    throw new ServiceUnavailableException(
      'Provider retornou referencia de cobranca invalida',
    );
  }
  return value;
}

function safePixQrCode(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.length > 4096) {
    throw new ServiceUnavailableException(
      'Provider retornou PIX invalido',
    );
  }
  return value;
}

@Injectable()
export class TenantPaymentCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly secrets: IntegrationSecretResolverService,
    private readonly adapters: TenantPaymentProviderAdapterRegistry,
    private readonly audit: AuditService,
  ) {}

  async listAvailableProviders(gymId: string) {
    const environment = this.runtime.current() as IntegrationEnvironment;
    const rows = await this.prisma.integrationConnection.findMany({
      where: {
        scope: IntegrationScope.TENANT,
        gymId,
        environment,
        status: IntegrationConnectionStatus.ACTIVE,
        secretReference: { not: null },
        secretVersion: { not: null },
        secretRevokedAt: null,
        OR: [{ secretExpiresAt: null }, { secretExpiresAt: { gt: new Date() } }],
      },
      orderBy: [{ providerCode: 'asc' }, { updatedAt: 'desc' }],
    });
    return rows
      .filter((connection) => hasCapability(connection.capabilities, TENANT_PAYMENT_CAPABILITY))
      .filter((connection) => {
        try {
          this.adapters.require(connection.providerCode);
          return true;
        } catch {
          return false;
        }
      })
      .map((connection) => ({
        connectionId: connection.id,
        providerCode: connection.providerCode,
      }));
  }

  private async resolveTenantConnection(gymId: string, providerConnectionId?: string) {
    const environment =
      this.runtime.current() as IntegrationEnvironment;
    const candidates = await this.prisma.integrationConnection.findMany({
      where: {
        scope: IntegrationScope.TENANT,
        gymId,
        ...(providerConnectionId ? { id: providerConnectionId } : {}),
        environment,
        status: IntegrationConnectionStatus.ACTIVE,
        secretReference: { not: null },
        secretVersion: { not: null },
        secretRevokedAt: null,
        OR: [
          { secretExpiresAt: null },
          { secretExpiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
    const capable = candidates.filter((connection) =>
      hasCapability(
        connection.capabilities,
        TENANT_PAYMENT_CAPABILITY,
      ),
    );
    if (capable.length !== 1) {
      throw new ServiceUnavailableException(
        capable.length === 0
          ? 'Gateway tenant nao configurado/homologado'
          : 'Mais de um gateway ativo: informe providerConnectionId para selecionar explicitamente',
      );
    }
    return capable[0];
  }

  async createSession(
    chargeId: string,
    dto: CreateChargePaymentSessionDto,
    gymId: string,
    actorUserId?: string,
  ) {
    const charge = await this.prisma.charge.findFirst({
      where: { id: chargeId, gymId },
    });
    if (!charge) {
      throw new NotFoundException('Cobranca nao encontrada');
    }
    if (
      charge.status !== ChargeStatus.PENDING &&
      charge.status !== ChargeStatus.FAILED
    ) {
      throw new ConflictException(
        'Cobranca nao aceita nova sessao de pagamento',
      );
    }

    if (charge.gatewayRequestId) {
      if (
        charge.gatewayRequestId === dto.requestId &&
        charge.gatewayChargeId
      ) {
        return {
          chargeId: charge.id,
          providerCode: charge.gatewayProviderCode,
          providerChargeRef: charge.gatewayChargeId,
          checkoutUrl: charge.paymentLink,
          pixQrCode: charge.pixQrCode,
          expiresAt: charge.gatewayCheckoutExpiresAt,
          idempotent: true,
        };
      }
      throw new ConflictException(
        'Cobranca ja possui sessao de pagamento com outro requestId',
      );
    }

    const connection = await this.resolveTenantConnection(gymId, dto.providerConnectionId);
    const adapter = this.adapters.require(connection.providerCode);
    const credential = await this.secrets.resolveForExternalBoundary(
      connection.id,
      { scope: 'TENANT', gymId },
    );

    const providerResult = await adapter.createCheckout({
      requestId: dto.requestId,
      chargeId: charge.id,
      studentId: charge.studentId,
      amount: charge.amount,
      currency: 'BRL',
      dueDate: charge.dueDate,
      publicConfiguration: connection.publicConfiguration,
      credential,
    });

    const providerChargeRef = safeProviderRef(
      providerResult.providerChargeRef,
    );
    const checkoutUrl = safeCheckoutUrl(
      providerResult.checkoutUrl,
    );
    const pixQrCode = safePixQrCode(providerResult.pixQrCode);
    const expiresAt =
      providerResult.expiresAt instanceof Date &&
      !Number.isNaN(providerResult.expiresAt.getTime())
        ? providerResult.expiresAt
        : null;

    if (!checkoutUrl && !pixQrCode) {
      throw new ServiceUnavailableException(
        'Provider nao retornou meio de checkout utilizavel',
      );
    }

    const updated = await this.prisma.charge.updateMany({
      where: {
        id: charge.id,
        gymId,
        status: {
          in: [ChargeStatus.PENDING, ChargeStatus.FAILED],
        },
        gatewayRequestId: null,
      },
      data: {
        gatewayProviderCode: connection.providerCode,
        gatewayConnectionId: connection.id,
        gatewayRequestId: dto.requestId,
        gatewayChargeId: providerChargeRef,
        gatewayCheckoutExpiresAt: expiresAt,
        paymentLink: checkoutUrl,
        pixQrCode,
      },
    });
    if (updated.count !== 1) {
      const replay = await this.prisma.charge.findFirst({
        where: { id: charge.id, gymId },
      });
      if (
        replay?.gatewayRequestId === dto.requestId &&
        replay.gatewayChargeId
      ) {
        return {
          chargeId: replay.id,
          providerCode: replay.gatewayProviderCode,
          providerChargeRef: replay.gatewayChargeId,
          checkoutUrl: replay.paymentLink,
          pixQrCode: replay.pixQrCode,
          expiresAt: replay.gatewayCheckoutExpiresAt,
          idempotent: true,
        };
      }
      throw new BadRequestException(
        'Conflito ao criar sessao de pagamento',
      );
    }

    await this.audit.record({
      gymId,
      userId: actorUserId ?? null,
      action: 'FINANCIAL_TENANT_CHECKOUT_CREATED',
      entity: 'Charge',
      entityId: charge.id,
      next: {
        providerCode: connection.providerCode,
        connectionId: connection.id,
        requestId: dto.requestId,
        providerChargeRef,
        checkoutExpiresAt: expiresAt,
        hasHostedCheckout: Boolean(checkoutUrl),
        hasPix: Boolean(pixQrCode),
      },
    });

    return {
      chargeId: charge.id,
      providerCode: connection.providerCode,
      providerChargeRef,
      checkoutUrl,
      pixQrCode,
      expiresAt,
      idempotent: false,
    };
  }
}
