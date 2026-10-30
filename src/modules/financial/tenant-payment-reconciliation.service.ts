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

  async reconcile(chargeId: string, accountId: string, gymId: string, actorUserId?: string) {
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
      if (verified.status === 'REVERSED' &&
          (charge.status === ChargeStatus.PAID || charge.status === ChargeStatus.REFUNDED)) {
        if (!verified.providerPaymentRef) {
          throw new ServiceUnavailableException('Estorno sem referencia de pagamento verificavel');
        }
        if (verified.reversalReason === 'FULL_REFUND' &&
            verified.reversedAmount === charge.amount) {
          const refund = await this.financial.refundVerifiedGatewayCharge(
            charge.id, gymId, actorUserId,
            { connectionId: connection.id,
              paymentRef: verified.providerPaymentRef,
              refundedAmount: verified.reversedAmount },
          );
          return {
            chargeId: charge.id,
            providerCode: connection.providerCode,
            status: 'REFUNDED',
            booked: false,
            reversalBooked: true,
            fiscalReviewRequired: true,
            idempotent: refund.idempotent,
            reversalTransactionId: refund.reversalTransactionId,
          };
        }
        // Do not book partial refunds or chargebacks as a full reversal.
        // Leave a tenant-scoped audit trail for owner/fiscal review.
        await this.audit.record({
          gymId, userId: actorUserId ?? null,
          action: 'FINANCIAL_GATEWAY_REVERSAL_REQUIRES_REVIEW',
          entity: 'Charge', entityId: charge.id,
          next: {
            providerCode: connection.providerCode,
            providerPaymentRef: verified.providerPaymentRef,
            reversalReason: verified.reversalReason ?? 'UNKNOWN',
            reversedAmount: verified.reversedAmount ?? null,
            chargeAmount: charge.amount,
            fiscalReviewRequired: true,
          },
        });
        return { chargeId: charge.id, providerCode: connection.providerCode,
          status: 'MANUAL_REVIEW', booked: false, requiresReview: true,
          fiscalReviewRequired: true };
      }
      if (charge.status === ChargeStatus.PAID || charge.status === ChargeStatus.REFUNDED) {
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
      { connectionId: connection.id, paymentRef: verified.providerPaymentRef },
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
