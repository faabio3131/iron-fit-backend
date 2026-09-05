import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductEntitlementKind,
  ProductPlanEntitlement,
  ProductPlanVersionStatus,
  TenantProductSubscriptionStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PRODUCT_FEATURE_CATALOG_V1,
  ProductFeatureDefinition,
} from './contracts/product-entitlement-contract';
import { AssignTenantProductSubscriptionDto } from './dto/assign-tenant-product-subscription.dto';

const SERIALIZABLE_ATTEMPTS = 3;

type ResolvedValue = boolean | number | readonly string[] | null;

type TenantResolutionContext = {
  gymActive: boolean;
  subscription: any | null;
};

@Injectable()
export class TenantProductEntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private requireGymId(gymId?: string): string {
    if (!gymId?.trim()) {
      throw new BadRequestException('Tenant ativo obrigatorio para resolver entitlements');
    }
    return gymId;
  }

  private featureDefinition(featureKey: string): Readonly<ProductFeatureDefinition> {
    const definition = PRODUCT_FEATURE_CATALOG_V1.find(
      (candidate) => candidate.key === featureKey,
    );
    if (!definition) {
      throw new BadRequestException(`Capability nao canonica: ${featureKey}`);
    }
    return definition;
  }

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable || attempt === SERIALIZABLE_ATTEMPTS) throw error;
      }
    }
    throw new ConflictException('Falha de concorrencia ao atribuir plano ao tenant');
  }

  private extractEntitlementValue(
    entitlement: ProductPlanEntitlement,
    definition: Readonly<ProductFeatureDefinition>,
  ): { valid: true; value: ResolvedValue } | { valid: false } {
    if (
      definition.kind === 'FEATURE' &&
      entitlement.kind === ProductEntitlementKind.FEATURE &&
      typeof entitlement.featureEnabled === 'boolean' &&
      entitlement.limitValue === null &&
      entitlement.policyValues === null
    ) {
      return { valid: true, value: entitlement.featureEnabled };
    }

    if (
      definition.kind === 'LIMIT' &&
      entitlement.kind === ProductEntitlementKind.LIMIT &&
      entitlement.featureEnabled === null &&
      Number.isInteger(entitlement.limitValue) &&
      (entitlement.limitValue ?? -1) >= 0 &&
      entitlement.policyValues === null
    ) {
      return { valid: true, value: entitlement.limitValue as number };
    }

    if (
      definition.kind === 'POLICY' &&
      entitlement.kind === ProductEntitlementKind.POLICY &&
      entitlement.featureEnabled === null &&
      entitlement.limitValue === null &&
      Array.isArray(entitlement.policyValues)
    ) {
      const raw = entitlement.policyValues as unknown[];
      const values = raw.filter((value): value is string => typeof value === 'string');
      const allowed = new Set(definition.allowedPolicyValues ?? []);
      if (
        values.length > 0 &&
        values.length === raw.length &&
        new Set(values).size === values.length &&
        values.every((value) => allowed.has(value))
      ) {
        return { valid: true, value: [...values] };
      }
    }

    return { valid: false };
  }

  private failClosed(
    definition: Readonly<ProductFeatureDefinition>,
    reason: string,
    subscription?: any | null,
  ) {
    return {
      featureKey: definition.key,
      kind: definition.kind,
      value: definition.failClosedDefault,
      source: 'FAIL_CLOSED_DEFAULT' as const,
      reason,
      subscriptionId: subscription?.id ?? null,
      plan: subscription
        ? {
            code: subscription.planVersion.productPlan.code,
            version: subscription.planVersion.version,
            status: subscription.planVersion.status,
          }
        : null,
    };
  }

  private resolveFromContext(
    definition: Readonly<ProductFeatureDefinition>,
    context: TenantResolutionContext,
  ) {
    if (!context.gymActive) {
      return this.failClosed(definition, 'TENANT_INACTIVE_OR_MISSING');
    }

    const subscription = context.subscription;
    if (!subscription) {
      return this.failClosed(definition, 'NO_ACTIVE_TENANT_SUBSCRIPTION');
    }

    const versionStatus = subscription.planVersion.status;
    if (
      versionStatus !== ProductPlanVersionStatus.PUBLISHED &&
      versionStatus !== ProductPlanVersionStatus.RETIRED
    ) {
      return this.failClosed(definition, 'PLAN_VERSION_NOT_EFFECTIVE', subscription);
    }

    const entitlement = subscription.planVersion.entitlements.find(
      (candidate: ProductPlanEntitlement) => candidate.featureKey === definition.key,
    ) as ProductPlanEntitlement | undefined;
    if (!entitlement) {
      return this.failClosed(definition, 'ENTITLEMENT_NOT_GRANTED', subscription);
    }

    const extracted = this.extractEntitlementValue(entitlement, definition);
    if (!extracted.valid) {
      return this.failClosed(definition, 'INVALID_ENTITLEMENT_DATA', subscription);
    }

    return {
      featureKey: definition.key,
      kind: definition.kind,
      value: extracted.value,
      source: 'PLAN_ENTITLEMENT' as const,
      reason: null,
      subscriptionId: subscription.id,
      plan: {
        code: subscription.planVersion.productPlan.code,
        version: subscription.planVersion.version,
        status: subscription.planVersion.status,
      },
    };
  }

  private async loadResolutionContext(gymId: string): Promise<TenantResolutionContext> {
    const gym = await this.prisma.gym.findUnique({
      where: { id: gymId },
      select: { id: true, active: true },
    });
    if (!gym?.active) return { gymActive: false, subscription: null };

    const subscription = await this.prisma.tenantProductSubscription.findFirst({
      where: {
        gymId,
        status: TenantProductSubscriptionStatus.ACTIVE,
      },
      orderBy: { effectiveFrom: 'desc' },
      include: {
        planVersion: {
          include: {
            productPlan: true,
            entitlements: { orderBy: { featureKey: 'asc' } },
          },
        },
      },
    });

    return { gymActive: true, subscription };
  }

  async assignInitialSubscription(
    dto: AssignTenantProductSubscriptionDto,
    actorUserId?: string,
  ) {
    return this.serializable(async (tx) => {
      const gym = await tx.gym.findUnique({ where: { id: dto.gymId } });
      if (!gym) throw new NotFoundException('Gym nao encontrada');
      if (!gym.active) throw new ConflictException('Gym inativa nao pode receber plano SaaS');

      const version = await tx.productPlanVersion.findFirst({
        where: {
          version: dto.version,
          productPlan: { code: dto.planCode },
        },
        include: { productPlan: true },
      });
      if (!version) throw new NotFoundException('Versao de ProductPlan nao encontrada');
      if (version.status !== ProductPlanVersionStatus.PUBLISHED) {
        throw new ConflictException('Somente versao PUBLISHED pode receber nova assinatura tenant');
      }

      const existing = await tx.tenantProductSubscription.findFirst({
        where: {
          gymId: dto.gymId,
          status: TenantProductSubscriptionStatus.ACTIVE,
        },
        include: { planVersion: { include: { productPlan: true } } },
      });
      if (existing) {
        if (existing.planVersionId === version.id) return existing;
        throw new ConflictException(
          'Tenant ja possui plano ativo; upgrade/downgrade pertence ao IRON-PE4',
        );
      }

      const subscription = await tx.tenantProductSubscription.create({
        data: {
          gymId: dto.gymId,
          planVersionId: version.id,
          status: TenantProductSubscriptionStatus.ACTIVE,
          effectiveFrom: new Date(),
        },
        include: { planVersion: { include: { productPlan: true } } },
      });

      await this.audit.record(
        {
          gymId: dto.gymId,
          userId: actorUserId ?? null,
          action: 'TENANT_PRODUCT_SUBSCRIPTION_ASSIGNED',
          entity: 'TenantProductSubscription',
          entityId: subscription.id,
          next: {
            planCode: version.productPlan.code,
            version: version.version,
            status: subscription.status,
            effectiveFrom: subscription.effectiveFrom,
          },
        },
        tx,
      );

      return subscription;
    });
  }

  async getCurrentSubscription(gymId?: string) {
    const scopedGymId = this.requireGymId(gymId);
    const context = await this.loadResolutionContext(scopedGymId);
    if (!context.gymActive) {
      throw new NotFoundException('Tenant ativo nao encontrado');
    }
    return context.subscription;
  }

  async resolveFeature(gymId: string | undefined, featureKey: string) {
    const scopedGymId = this.requireGymId(gymId);
    const definition = this.featureDefinition(featureKey);
    const context = await this.loadResolutionContext(scopedGymId);
    return this.resolveFromContext(definition, context);
  }

  async resolveAll(gymId?: string) {
    const scopedGymId = this.requireGymId(gymId);
    const context = await this.loadResolutionContext(scopedGymId);
    return PRODUCT_FEATURE_CATALOG_V1.map((definition) =>
      this.resolveFromContext(definition, context),
    );
  }
}
