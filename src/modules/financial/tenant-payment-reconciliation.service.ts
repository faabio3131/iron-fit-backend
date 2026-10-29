import {
  ConflictException, Injectable, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import {
  ChargeStatus, IntegrationConnectionStatus, IntegrationEnvironment, IntegrationScope,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';
import { IntegrationSecretResolverService } from '../integrations/secrets/integration-secret-resolver.service';
import { FinancialService } from './financial.service';
import { TenantPaymentProviderAdapterRegistry } from './tenant-payment-provider-adapter';

@Injectable()
export class TenantPaymentReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly secrets: IntegrationSecretResolverService,
    private readonly adapters: TenantPaymentProviderAdapterRegistry,
    private readonly financial: FinancialService,
    private readonly audit: AuditService,
  ) {}

  async reconcile(chargeId: string, accountId: string, gymId: string, actorUserId: string) {
    const charge = await this.prisma.charge.findFirst({ where: { id: chargeId, gymId } });
    if (!charge) throw new NotFoundException('Cobranca nao encontrada');
    if (!charge.gatewayProviderCode || !charge.gatewayConnectionId || !charge.gatewayChargeId ||
        !charge.gatewayRequestId) {
      throw new ConflictException('Cobranca sem sessao de checkout do gateway');
    }
    const environment = this.runtime.current() as IntegrationEnvironment;
    const connection = await this.prisma.integrationConnection.findFirst({
      where: {
        id: charge.gatewayConnectionId,
        providerCode: charge.gatewayProviderCode,
        scope: IntegrationScope.TENANT,
        gymId,
        environment,
        status: IntegrationConnectionStatus.ACTIVE,
        secretReference: { not: null },
        secretVersion: { not: null },
        secretRevokedAt: null,
        OR: [{ secretExpiresAt: null }, { secretExpiresAt: { gt: new Date() } }],
      },
    });
    if (!connection) throw new ServiceUnavailableException('Conexao de pagamento indisponivel');
    const adapter = this.adapters.require(connection.providerCode);
    if (!adapter.verifyCheckout) {
      throw new ServiceUnavailableException('Provider nao oferece verificacao de liquidacao certificada');
    }
    const credential = await this.secrets.resolveForExternalBoundary(
      connection.id, { scope: 'TENANT', gymId },
    );
    const verified = await adapter.verifyCheckout({
      chargeId: charge.id,
      providerChargeRef: charge.gatewayChargeId,
      amount: charge.amount,
      currency: 'BRL',
      environment,
      credential,
    });
    if (verified.status !== 'PAID') {
      if (charge.status === ChargeStatus.PAID) {
        throw new ConflictException('Baixa anterior diverge do estado atual do provider: exige revisao financeira');
      }
      return {
        chargeId: charge.id,
        providerCode: connection.providerCode,
        status: verified.status,
        booked: false,
      };
    }
    if (!verified.providerPaymentRef) {
      throw new ServiceUnavailableException('Provider nao forneceu referencia verificavel do pagamento');
    }
    const result = await this.financial.payCharge(
      charge.id,
      {
        accountId,
        paymentMethod: 'GATEWAY_' + connection.providerCode.toUpperCase(),
        ...(verified.paidAt ? { paidAt: verified.paidAt.toISOString() } : {}),
      },
      gymId,
      actorUserId,
    );
    await this.audit.record({
      gymId, userId: actorUserId,
      action: 'FINANCIAL_TENANT_PROVIDER_PAYMENT_VERIFIED',
      entity: 'Charge', entityId: charge.id,
      next: {
        providerCode: connection.providerCode,
        providerConnectionId: connection.id,
        providerPaymentRef: verified.providerPaymentRef,
        settlementStatus: 'PAID',
        idempotent: result.idempotent,
      },
    });
    return {
      chargeId: charge.id,
      providerCode: connection.providerCode,
      providerPaymentRef: verified.providerPaymentRef,
      status: 'PAID',
      booked: true,
      idempotent: result.idempotent,
    };
  }
}
