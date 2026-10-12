import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TenantProductSubscriptionStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantProductSubscriptionLifecycleService } from '../product-entitlements/tenant-product-subscription-lifecycle.service';
import { FmCommandSubscriptionCommandDto } from './dto/fm-command-subscription-command.dto';

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => JSON.stringify(key) + ':' + stable(nested))
    .join(',') + '}';
}

function payloadHash(value: unknown) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function safeErrorCode(error: unknown) {
  if (error instanceof Error) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
  }
  return 'FM_COMMAND_CONTROL_PLANE_ERROR';
}

@Injectable()
export class FmCommandControlPlaneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lifecycle: TenantProductSubscriptionLifecycleService,
  ) {}

  health() {
    return {
      status: 'ok',
      schema_version: 'iron.fmcc.control-plane.v1',
      product_code: 'IRON_FIT_CORE',
      billing_authority: 'FM_COMMAND',
      generated_at: new Date().toISOString(),
    };
  }

  async snapshot() {
    const now = new Date();
    const [gyms, trials, onboarding, subscriptions] = await Promise.all([
      this.prisma.gym.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          active: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { students: true, userRoles: true } },
        },
      }),
      this.prisma.commercialTrialProvisioning.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          requestId: true,
          gymId: true,
          subscriptionId: true,
          trialStartedAt: true,
          trialEndsAt: true,
          createdAt: true,
        },
      }),
      this.prisma.commercialOnboardingCheckpoint.findMany({
        orderBy: [{ gymId: 'asc' }, { completedAt: 'asc' }],
        select: {
          id: true,
          gymId: true,
          step: true,
          completedAt: true,
        },
      }),
      this.prisma.tenantProductSubscription.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          planVersion: {
            include: {
              productPlan: true,
              entitlements: true,
            },
          },
        },
      }),
    ]);

    const customers = gyms.map((gym) => ({
      tenant_id: gym.id,
      name: gym.name,
      slug: gym.slug,
      active: gym.active,
      student_count: gym._count.students,
      team_membership_count: gym._count.userRoles,
      created_at: gym.createdAt.toISOString(),
      updated_at: gym.updatedAt.toISOString(),
    }));

    const trialRows = trials.map((trial) => ({
      external_id: trial.requestId,
      tenant_id: trial.gymId,
      subscription_id: trial.subscriptionId,
      status: trial.trialEndsAt > now ? 'active' : 'expired',
      started_at: trial.trialStartedAt.toISOString(),
      ends_at: trial.trialEndsAt.toISOString(),
      created_at: trial.createdAt.toISOString(),
    }));

    const subscriptionRows = subscriptions.map((subscription) => ({
      external_id: subscription.id,
      tenant_id: subscription.gymId,
      status: subscription.status,
      plan_code: subscription.planVersion.productPlan.code,
      plan_version: subscription.planVersion.version,
      effective_from: subscription.effectiveFrom.toISOString(),
      effective_until: subscription.effectiveUntil?.toISOString() ?? null,
      updated_at: subscription.updatedAt.toISOString(),
    }));

    const entitlementRows = subscriptions.flatMap((subscription) =>
      subscription.planVersion.entitlements.map((entitlement) => ({
        tenant_id: subscription.gymId,
        subscription_id: subscription.id,
        feature_key: entitlement.featureKey,
        kind: entitlement.kind,
        feature_enabled: entitlement.featureEnabled,
        limit_value: entitlement.limitValue,
        policy_values: entitlement.policyValues,
        source_plan_code: subscription.planVersion.productPlan.code,
        source_plan_version: subscription.planVersion.version,
      })),
    );

    const onboardingRows = onboarding.map((checkpoint) => ({
      external_id: checkpoint.id,
      tenant_id: checkpoint.gymId,
      step: checkpoint.step,
      completed_at: checkpoint.completedAt.toISOString(),
    }));

    const facts = [
      ...customers.map((item) => ({
        external_id: 'tenant:' + item.tenant_id,
        fact_type: 'iron.tenant',
        payload: item,
        source_timestamp: item.updated_at,
      })),
      ...trialRows.map((item) => ({
        external_id: 'trial:' + item.external_id,
        fact_type: 'iron.trial',
        payload: item,
        source_timestamp: item.created_at,
      })),
      ...subscriptionRows.map((item) => ({
        external_id: 'subscription:' + item.external_id,
        fact_type: 'iron.subscription',
        payload: item,
        source_timestamp: item.updated_at,
      })),
      ...onboardingRows.map((item) => ({
        external_id: 'onboarding:' + item.external_id,
        fact_type: 'iron.onboarding',
        payload: item,
        source_timestamp: item.completed_at,
      })),
    ];

    return {
      schema_version: 'iron.fmcc.commercial.v1',
      product_code: 'IRON_FIT_CORE',
      as_of: now.toISOString(),
      customers,
      trials: trialRows,
      subscriptions: subscriptionRows,
      entitlements: entitlementRows,
      onboarding: onboardingRows,
      billing_transactions: [],
      summary: {
        customers: customers.length,
        active_customers: customers.filter((item) => item.active).length,
        active_trials: trialRows.filter((item) => item.status === 'active').length,
        active_subscriptions: subscriptionRows.filter((item) => item.status === 'ACTIVE').length,
        suspended_subscriptions: subscriptionRows.filter((item) => item.status === 'SUSPENDED').length,
        canceled_subscriptions: subscriptionRows.filter((item) => item.status === 'CANCELED').length,
      },
      facts,
      coverage: {
        tenant: 'IRON_CANONICAL',
        trial: 'IRON_CANONICAL',
        onboarding: 'IRON_CANONICAL',
        subscription_projection: 'IRON_CANONICAL',
        entitlement_definition: 'IRON_CANONICAL',
        billing_transactions: 'FM_COMMAND_AUTHORITY',
      },
    };
  }

  async executeSubscriptionCommand(
    dto: FmCommandSubscriptionCommandDto,
    idempotencyKey: string,
    correlationId: string,
  ) {
    const key = idempotencyKey.trim();
    if (!key || key.length > 160) {
      throw new BadRequestException('Idempotency-Key invalido');
    }

    const hash = payloadHash(dto);
    const existing = await this.prisma.fmCommandControlPlaneCommand.findUnique({
      where: { idempotencyKey: key },
    });

    if (existing) {
      if (existing.payloadHash !== hash) {
        throw new ConflictException('Idempotency-Key reutilizado com payload diferente');
      }
      if (existing.status === 'COMPLETED' && existing.result) {
        return { idempotent: true, result: existing.result };
      }
      throw new ConflictException('Comando FM Command ja recebido e nao pode ser reexecutado automaticamente');
    }

    try {
      await this.prisma.fmCommandControlPlaneCommand.create({
        data: {
          idempotencyKey: key,
          payloadHash: hash,
          gymId: dto.gymId,
          action: dto.action,
          status: 'PROCESSING',
          correlationId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.fmCommandControlPlaneCommand.findUnique({
          where: { idempotencyKey: key },
        });
        if (raced?.payloadHash === hash && raced.status === 'COMPLETED' && raced.result) {
          return { idempotent: true, result: raced.result };
        }
        throw new ConflictException('Comando concorrente em processamento');
      }
      throw error;
    }

    try {
      const result = dto.action === 'subscription.plan.transition'
        ? await this.transitionPlan(dto)
        : await this.syncStatus(dto);

      await this.prisma.fmCommandControlPlaneCommand.update({
        where: { idempotencyKey: key },
        data: {
          status: 'COMPLETED',
          result: result as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });

      return { idempotent: false, result };
    } catch (error) {
      await this.prisma.fmCommandControlPlaneCommand.update({
        where: { idempotencyKey: key },
        data: {
          status: 'FAILED',
          errorCode: safeErrorCode(error),
          processedAt: new Date(),
        },
      }).catch(() => undefined);
      throw error;
    }
  }

  private async transitionPlan(dto: FmCommandSubscriptionCommandDto) {
    if (!dto.planCode || !dto.planVersion || !dto.transitionKind) {
      throw new BadRequestException('Transicao de plano exige planCode, planVersion e transitionKind');
    }

    const expectedKind = dto.commercialStatus === 'upgrade'
      ? 'UPGRADE'
      : dto.commercialStatus === 'downgrade'
        ? 'DOWNGRADE'
        : dto.transitionKind;
    if (dto.transitionKind !== expectedKind) {
      throw new BadRequestException('transitionKind diverge do estado comercial');
    }

    return this.lifecycle.transition({
      gymId: dto.gymId,
      expectedCurrentSubscriptionId: dto.expectedSubscriptionId,
      planCode: dto.planCode,
      version: dto.planVersion,
      transitionKind: dto.transitionKind,
      reason: 'FM Command: ' + dto.reason,
    }, 'system:fm-command');
  }

  private async syncStatus(dto: FmCommandSubscriptionCommandDto) {
    if (!dto.entitlementStatus) {
      throw new BadRequestException('Sincronizacao de status exige entitlementStatus');
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.tenantProductSubscription.findFirst({
        where: { id: dto.expectedSubscriptionId, gymId: dto.gymId },
        include: { planVersion: { include: { productPlan: true } } },
      });
      if (!current) throw new NotFoundException('Assinatura IRON nao encontrada');

      const target = dto.entitlementStatus as TenantProductSubscriptionStatus;
      if (
        current.status === TenantProductSubscriptionStatus.CANCELED &&
        target !== TenantProductSubscriptionStatus.CANCELED
      ) {
        throw new ConflictException('Assinatura cancelada nao pode ser reativada por status.sync');
      }

      const updated = current.status === target
        ? current
        : await tx.tenantProductSubscription.update({
            where: { id: current.id },
            data: {
              status: target,
              ...(target === TenantProductSubscriptionStatus.CANCELED
                ? { effectiveUntil: current.effectiveUntil ?? new Date() }
                : {}),
            },
            include: { planVersion: { include: { productPlan: true } } },
          });

      await this.audit.record({
        gymId: dto.gymId,
        userId: null,
        action: 'FM_COMMAND_SUBSCRIPTION_STATUS_SYNCED',
        entity: 'TenantProductSubscription',
        entityId: updated.id,
        previous: {
          status: current.status,
          commercialStatus: dto.commercialStatus,
        },
        next: {
          status: updated.status,
          commercialStatus: dto.commercialStatus,
          planCode: updated.planVersion.productPlan.code,
          planVersion: updated.planVersion.version,
          reason: dto.reason,
        },
      }, tx);

      return {
        changed: current.status !== updated.status,
        subscriptionId: updated.id,
        tenantId: updated.gymId,
        entitlementStatus: updated.status,
        commercialStatus: dto.commercialStatus,
        planCode: updated.planVersion.productPlan.code,
        planVersion: updated.planVersion.version,
      };
    });
  }
}
