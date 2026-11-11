import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, TenantProductSubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { TenantProductEntitlementsService } from '../../product-entitlements/tenant-product-entitlements.service';
import { AiCapability } from '../contracts/ai-contract';

type QuotaGroup = 'WORKOUT' | 'ADVISORY';
const FEATURE_KEY: Record<QuotaGroup, string> = {
  WORKOUT: 'ai.workout_monthly_max',
  ADVISORY: 'ai.advisory_monthly_max',
};
const MAX_RETRIES = 4;
// Bounded compatibility for the two immutable launch plan versions.
// Neither missing quota capability definitions nor legacy contracts imply unlimited AI.
const LEGACY_V1_MONTHLY_ALLOWANCE: Readonly<Record<string, Readonly<Record<QuotaGroup, number>>>> = Object.freeze({
  IRON_V1_TRIAL: Object.freeze({ WORKOUT: 10, ADVISORY: 20 }),
  IRON_V1: Object.freeze({ WORKOUT: 50, ADVISORY: 100 }),
});
// Package codes are identifiers only. Prices and payment settlement belong exclusively to FM Command.
export const WORKOUT_CREDIT_PACK_UNITS: Readonly<Record<string, number>> = Object.freeze({
  IRON_AI_WORKOUT_100: 100,
  IRON_AI_WORKOUT_300: 300,
  IRON_AI_WORKOUT_1000: 1000,
});

export function quotaGroupFor(capability: AiCapability): QuotaGroup {
  return capability === 'WORKOUT_GENERATION' ? 'WORKOUT' : 'ADVISORY';
}

/** Contract anniversary in UTC, clamped at month end (e.g. 31 Jan -> 28 Feb). */
export function monthlyCycle(anchor: Date, now: Date): { start: Date; end: Date } {
  const anniversary = (offset: number) => {
    const index = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + offset;
    const year = Math.floor(index / 12);
    const month = ((index % 12) + 12) % 12;
    const day = Math.min(anchor.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    return new Date(Date.UTC(year, month, day, anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()));
  };
  let offset = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  if (anniversary(offset) > now) offset--;
  const start = anniversary(offset);
  const end = anniversary(offset + 1);
  return { start, end };
}

@Injectable()
export class AiMonthlyQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: TenantProductEntitlementsService,
    private readonly audit: AuditService,
  ) {}

  async usage(tenantId: string, capability: AiCapability) {
    const group = quotaGroupFor(capability);
    const now = new Date();
    const subscription = await this.prisma.tenantProductSubscription.findFirst({
      where: { gymId: tenantId, status: TenantProductSubscriptionStatus.ACTIVE,
        effectiveFrom: { lte: now }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
      orderBy: { effectiveFrom: 'desc' },
      include: {
        saasBillingAgreement: { select: { currentPeriodStart: true, currentPeriodEnd: true } },
        planVersion: { select: { version: true, productPlan: { select: { code: true } } } },
      },
    });
    if (!subscription) return { group, allowance: 0, used: 0, remaining: 0, percent: 0, periodStart: null, periodEnd: null };
    let includedAllowance = 0;
    const currentCode = subscription.planVersion.productPlan.code;
    const legacy = subscription.planVersion.version === 1 ? LEGACY_V1_MONTHLY_ALLOWANCE[currentCode] : undefined;
    if (legacy) {
      // Previous launch contracts never contained the new LIMIT keys. The
      // effective *existing* AI feature must still be granted by the canonical
      // resolver, including tenant-level narrowing and subscription status.
      const gateKey = group === 'WORKOUT' ? 'ai.workout_generation' : 'ai.content_recommendation';
      const feature = await this.entitlements.resolveFeature(tenantId, gateKey);
      if (feature.value === true && feature.plan?.code === currentCode &&
          feature.plan.version === 1) includedAllowance = legacy[group];
    } else {
      const resolution = await this.entitlements.resolveFeature(tenantId, FEATURE_KEY[group]);
      includedAllowance = typeof resolution.value === 'number' && Number.isSafeInteger(resolution.value)
        ? Math.max(0, resolution.value) : 0;
    }
    const billing = subscription.saasBillingAgreement;
    // Never reset consumption simply because a plan transition creates a new subscription row.
    const firstSubscription = await this.prisma.tenantProductSubscription.findFirst({
      where: { gymId: tenantId, effectiveFrom: { lte: now } },
      orderBy: { effectiveFrom: 'asc' },
      select: { effectiveFrom: true },
    });
    // A YEARLY subscription has a yearly paidThrough window, but AI allowance is MONTHLY.
    const billingActive = billing?.currentPeriodStart && billing.currentPeriodEnd
      && billing.currentPeriodStart <= now && now < billing.currentPeriodEnd;
    const cycle = monthlyCycle(
      billingActive ? billing!.currentPeriodStart! : firstSubscription?.effectiveFrom ?? subscription.effectiveFrom,
      now,
    );
    const [used, purchased] = await Promise.all([
      this.prisma.aiMonthlyConsumption.count({
        where: { tenantId, group, periodStart: cycle.start, state: { in: ['RESERVED', 'CONSUMED'] } },
      }),
      this.prisma.aiCreditGrant.aggregate({
        where: { tenantId, group, periodStart: cycle.start, periodEnd: cycle.end, revokedAt: null },
        _sum: { units: true },
      }),
    ]);
    const extraAllowance = purchased._sum.units ?? 0;
    const allowance = includedAllowance + extraAllowance;
    return { group, includedAllowance, extraAllowance, allowance, used, remaining: Math.max(0, allowance - used),
      percent: allowance ? Math.min(100, Math.floor(used * 100 / allowance)) : 100,
      periodStart: cycle.start, periodEnd: cycle.end };
  }

  /** Serializable check-and-reserve: one commercial unit per logical request, not per provider retry. */
  async reserve(tenantId: string, capability: AiCapability, requestId: string) {
    if (!tenantId || !requestId || requestId.length > 160) return { allowed: false, code: 'AI_QUOTA_CONTEXT_INVALID' };
    const snapshot = await this.usage(tenantId, capability);
    if (!snapshot.periodStart || !snapshot.periodEnd || snapshot.allowance <= 0) {
      return { allowed: false, code: 'AI_MONTHLY_QUOTA_UNAVAILABLE' };
    }
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const identity = { tenantId, group: snapshot.group, periodStart: snapshot.periodStart!, requestId };
          const previous = await tx.aiMonthlyConsumption.findUnique({
            where: { tenantId_group_periodStart_requestId: identity },
          });
          if (previous) return { allowed: false, code: 'AI_QUOTA_REQUEST_REPLAY' };
          const count = await tx.aiMonthlyConsumption.count({
            where: { tenantId, group: snapshot.group, periodStart: snapshot.periodStart!, state: { in: ['RESERVED', 'CONSUMED'] } },
          });
          if (count >= snapshot.allowance) return { allowed: false, code: 'AI_MONTHLY_QUOTA_EXHAUSTED' };
          await tx.aiMonthlyConsumption.create({ data: {
            ...identity, periodEnd: snapshot.periodEnd!, state: 'RESERVED',
          } });
          return { allowed: true, code: 'AI_QUOTA_RESERVED', periodStart: snapshot.periodStart!, group: snapshot.group };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === 'P2034' || error.code === 'P2002') && attempt < MAX_RETRIES - 1) continue;
        throw error;
      }
    }
    return { allowed: false, code: 'AI_QUOTA_RESERVATION_FAILED' };
  }

  async finalize(tenantId: string, capability: AiCapability, requestId: string, periodStart: Date, success: boolean) {
    await this.prisma.aiMonthlyConsumption.updateMany({
      where: { tenantId, group: quotaGroupFor(capability), requestId, periodStart, state: 'RESERVED' },
      data: { state: success ? 'CONSUMED' : 'RELEASED', finishedAt: new Date() },
    });
  }

  /** Release only the exact monthly reservation that produced the rejected candidate. */
  async releaseRejectedWorkout(tenantId: string, requestId: string, periodStart: Date | undefined) {
    // Never derive the period from today's date: provider responses can cross a billing-cycle boundary.
    if (!tenantId?.trim() || !requestId?.trim()
      || !(periodStart instanceof Date) || !Number.isFinite(periodStart.getTime())) return;
    await this.prisma.aiMonthlyConsumption.updateMany({
      where: { tenantId, group: 'WORKOUT', requestId, periodStart, state: 'CONSUMED' },
      data: { state: 'RELEASED', finishedAt: new Date() },
    });
  }

  /** Only FM Command's authenticated S2S boundary may call this after its canonical invoice is PAID. */
  async grantPaidWorkoutPack(input: {
    tenantId: string;
    sourceInvoiceId: string;
    packageCode: string;
    paymentStatus: string;
  }) {
    const units = WORKOUT_CREDIT_PACK_UNITS[input.packageCode];
    if (!units || input.paymentStatus !== 'PAID'
      || !/^[A-Za-z0-9:_-]{8,160}$/.test(input.sourceInvoiceId ?? '')
      || !input.tenantId?.trim()) {
      throw new BadRequestException('Pacote IA ou comprovacao financeira invalida');
    }
    const snapshot = await this.usage(input.tenantId, 'WORKOUT_GENERATION');
    if (!snapshot.periodStart || !snapshot.periodEnd)
      throw new BadRequestException('Academia sem assinatura ativa para creditos de IA');
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.aiCreditGrant.findUnique({
            where: { sourceInvoiceId: input.sourceInvoiceId },
          });
          if (existing) {
            if (existing.tenantId !== input.tenantId
              || existing.packageCode !== input.packageCode || existing.revokedAt)
              throw new ConflictException('Referencia financeira de IA ja utilizada');
            return { idempotent: true, grantId: existing.id, units: existing.units };
          }
          // Never accept settled money and then refuse the matching finite credit pack.
          // Commercial abuse/spend caps must be enforced BEFORE checkout by FM Command.
          const created = await tx.aiCreditGrant.create({ data: {
            tenantId: input.tenantId, group: 'WORKOUT',
            packageCode: input.packageCode, units, sourceInvoiceId: input.sourceInvoiceId,
            periodStart: snapshot.periodStart!, periodEnd: snapshot.periodEnd!,
          } });
          await this.audit.record({
            gymId: input.tenantId, userId: null,
            action: 'AI_PAID_CREDITS_GRANTED', entity: 'AiCreditGrant', entityId: created.id,
            next: { packageCode: input.packageCode, units, sourceInvoiceId: input.sourceInvoiceId,
              periodStart: snapshot.periodStart!.toISOString(), periodEnd: snapshot.periodEnd!.toISOString() },
          }, tx);
          return { idempotent: false, grantId: created.id, units };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === 'P2034' || error.code === 'P2002') && attempt < MAX_RETRIES - 1) continue;
        throw error;
      }
    }
    throw new ConflictException('Concorrencia no credito adicional de IA');
  }

  /** Refund/reversal sent by FM Command invalidates unused extra credits, without deleting the audit trail. */
  async revokePaidWorkoutPack(input: { tenantId: string; sourceInvoiceId: string }) {
    if (!input.tenantId?.trim() || !/^[A-Za-z0-9:_-]{8,160}$/.test(input.sourceInvoiceId ?? ''))
      throw new BadRequestException('Referencia financeira invalida');
    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.aiCreditGrant.findUnique({ where: { sourceInvoiceId: input.sourceInvoiceId } });
      // Refund can overtake a still-pending GRANT delivery: no credit is a safe idempotent no-op.
      if (!grant) return { idempotent: true, revoked: 0 };
      if (grant.tenantId !== input.tenantId) throw new ConflictException('Credito pertence a outra academia');
      if (grant.revokedAt) return { idempotent: true, revoked: 0 };
      const revoked = await tx.aiCreditGrant.updateMany({
        where: { id: grant.id, revokedAt: null }, data: { revokedAt: new Date() },
      });
      if (revoked.count) await this.audit.record({
        gymId: input.tenantId, userId: null,
        action: 'AI_PAID_CREDITS_REVOKED', entity: 'AiCreditGrant', entityId: grant.id,
        previous: { units: grant.units, packageCode: grant.packageCode, sourceInvoiceId: grant.sourceInvoiceId },
        next: { revoked: true },
      }, tx);
      return { idempotent: false, revoked: revoked.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
