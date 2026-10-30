import {
  ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPaymentReconciliationService } from './tenant-payment-reconciliation.service';

// The first retry waits one minute. Repeated failures back off to at most an hour.
// attemptCount is tenant-inbox-owned and incremented by the atomic claim.
export function nextGatewayRetryAt(
  attemptCount: number,
  now: Date = new Date(),
): Date {
  const retries = Number.isSafeInteger(attemptCount) && attemptCount > 0
    ? Math.min(attemptCount - 1, 6) : 0;
  return new Date(now.getTime() + Math.min(3_600_000, 60_000 * 2 ** retries));
}

/**
 * A signed webhook is a notification only. Reconciliation uses the canonical
 * tenant-bound checkout credential and queries the payment provider directly.
 * An OWNER with active step-up selects a real financial account for booking.
 */
@Injectable()
export class TenantPaymentWebhookReconcileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliation: TenantPaymentReconciliationService,
    private readonly audit: AuditService,
  ) {}

  async processEvent(eventId: string, accountId: string, gymId: string, actorId?: string) {
    const event = await this.prisma.tenantPaymentWebhookInbox.findFirst({
      where: { id: eventId, gymId },
    });
    if (!event) throw new NotFoundException('Evento de pagamento nao encontrado');
    if (event.status === 'RECONCILED') {
      return { eventId: event.id, status: 'RECONCILED', idempotent: true };
    }
    if (event.status !== 'RECEIVED' && event.status !== 'RETRY') {
      return { eventId: event.id, status: event.status, processed: false };
    }
    // Only prebound signed events may be reconciled, never raw webhook data.
    if (!['stripe', 'mercado_pago'].includes(event.providerCode) || !event.chargeId) {
      return { eventId: event.id, status: 'MANUAL_REVIEW', processed: false };
    }
    const linkedCharge = await this.prisma.charge.findFirst({
      where: {
        id: event.chargeId,
        gymId,
        gatewayProviderCode: event.providerCode,
        ...(event.providerCode === 'stripe' ? { gatewayChargeId: event.providerObjectRef } : {}),
      },
      select: { id: true },
    });
    if (!linkedCharge) {
      throw new ConflictException('Evento nao corresponde a uma cobranca tenant');
    }
    const claimed = await this.prisma.tenantPaymentWebhookInbox.updateMany({
      where: { id: event.id, gymId, status: event.status },
      data: { status: 'PROCESSING', attemptCount: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      return { eventId: event.id, status: 'CONCURRENT', processed: false };
    }
    try {
      const result = await this.reconciliation.reconcile(
        linkedCharge.id, accountId, gymId, actorId,
      );
      const terminal = result.status === 'PAID' ? 'RECONCILED'
        : result.status === 'REFUNDED' ? 'RECONCILED'
        : result.status === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW'
        : 'RETRY';
      await this.prisma.tenantPaymentWebhookInbox.updateMany({
        where: { id: event.id, gymId, status: 'PROCESSING' },
        data: { status: terminal, nextAttemptAt: nextGatewayRetryAt(event.attemptCount + 1) },
      });
      await this.audit.record({
        gymId, userId: actorId,
        action: 'FINANCIAL_SIGNED_WEBHOOK_RECONCILED',
        entity: 'TenantPaymentWebhookInbox', entityId: event.id,
        next: { status: terminal, chargeId: linkedCharge.id, providerCode: event.providerCode },
      });
      return { eventId: event.id, status: terminal, processed: true };
    } catch (error) {
      await this.prisma.tenantPaymentWebhookInbox.updateMany({
        where: { id: event.id, gymId, status: 'PROCESSING' },
        data: { status: 'RETRY', nextAttemptAt: nextGatewayRetryAt(event.attemptCount + 1) },
      });
      throw error;
    }
  }
}
