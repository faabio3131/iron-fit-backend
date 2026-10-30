import {
  BadRequestException, Injectable, NotFoundException,
  OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPaymentWebhookReconcileService } from './tenant-payment-webhook-reconcile.service';

const INTERVAL_MS = 60_000;
const MAX_EVENTS_PER_CYCLE = 20;
const MAX_ATTEMPTS = 8;

@Injectable()
export class TenantPaymentReconciliationAutomationService
  implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciler: TenantPaymentWebhookReconcileService,
    private readonly audit: AuditService,
  ) {}

  async configure(
    gymId: string,
    accountId: string,
    enabled: boolean,
    actorUserId: string,
  ) {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id: accountId, gymId, active: true },
    });
    if (!account) throw new NotFoundException('Conta financeira nao encontrada na academia');
    const record = await this.prisma.tenantPaymentReconciliationPolicy.upsert({
      where: { gymId },
      create: { gymId, accountId, enabled, updatedByUserId: actorUserId },
      update: { accountId, enabled, updatedByUserId: actorUserId },
    });
    await this.audit.record({
      gymId, userId: actorUserId,
      action: 'FINANCIAL_AUTOMATED_RECONCILIATION_POLICY_CHANGED',
      entity: 'TenantPaymentReconciliationPolicy', entityId: gymId,
      next: { enabled: record.enabled, accountId: record.accountId },
    });
    return { gymId, accountId: record.accountId, enabled: record.enabled };
  }

  async getPolicy(gymId: string) {
    const policy = await this.prisma.tenantPaymentReconciliationPolicy.findUnique({
      where: { gymId },
    });
    return { gymId, enabled: policy?.enabled === true, accountId: policy?.accountId ?? null };
  }

  onModuleInit() {
    // Both explicit infrastructure opt-in AND tenant OWNER policy are required.
    // No operational automation is enabled by simply deploying this code.
    if (process.env.IRON_PAYMENT_AUTO_RECONCILE_ENABLED !== 'true') return;
    this.timer = setInterval(() => { void this.runCycle().catch(() => undefined); }, INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runCycle() {
    if (process.env.IRON_PAYMENT_AUTO_RECONCILE_ENABLED !== 'true') {
      return { processed: 0, disabled: true };
    }
    if (this.active) return { processed: 0, concurrent: true };
    this.active = true;
    let processed = 0;
    try {
      const now = new Date();
      // Recover abandoned claims only after a bounded processing lease.
      await this.prisma.tenantPaymentWebhookInbox.updateMany({
        where: {
          status: 'PROCESSING',
          updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) },
        },
        data: { status: 'RETRY', nextAttemptAt: now },
      });
      const candidates = await this.prisma.tenantPaymentWebhookInbox.findMany({
        where: {
          providerCode: 'stripe',
          chargeId: { not: null },
          status: { in: ['RECEIVED', 'RETRY'] },
          nextAttemptAt: { lte: now },
          attemptCount: { lt: MAX_ATTEMPTS },
        },
        take: MAX_EVENTS_PER_CYCLE,
        orderBy: [{ receivedAt: 'asc' }],
      });
      for (const event of candidates) {
        const policy = await this.prisma.tenantPaymentReconciliationPolicy.findUnique({
          where: { gymId: event.gymId },
        });
        if (!policy?.enabled) continue;
        const account = await this.prisma.financialAccount.findFirst({
          where: { id: policy.accountId, gymId: event.gymId, active: true },
        });
        if (!account) continue;
        try {
          await this.reconciler.processEvent(event.id, policy.accountId, event.gymId, undefined);
          processed += 1;
        } catch {
          // The reconciler persists RETRY and the next retry time.
          // Never mark a payment paid from the inbox worker itself.
        }
      }
      await this.prisma.tenantPaymentWebhookInbox.updateMany({
        where: {
          status: 'RETRY',
          attemptCount: { gte: MAX_ATTEMPTS },
        },
        data: { status: 'MANUAL_REVIEW' },
      });
      return { processed, disabled: false };
    } finally {
      this.active = false;
    }
  }
}
