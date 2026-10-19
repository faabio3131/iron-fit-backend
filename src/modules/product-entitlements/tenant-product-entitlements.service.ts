import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  canNarrowFeature,
  canNarrowLimit,
  canNarrowPolicy,
  ProductFeatureDefinition,
} from './contracts/product-entitlement-contract';
import { ProductCapabilityCatalogService } from './product-capability-catalog.service';
import { AssignTenantProductSubscriptionDto } from './dto/assign-tenant-product-subscription.dto';
import { SetProductConfigurationValueDto } from './dto/set-product-configuration-value.dto';

const SERIALIZABLE_ATTEMPTS = 3;

// The tenant API only adjusts operational preferences; FM owns commercial
// grants/quotas and IRON's canonical plan is the entitlement authority.
const TENANT_OPERATIONAL_FEATURE_KEYS = new Set([
  'ai.workout_generation',
  'ai.content_recommendation',
  'content.external_youtube',
  'content.iron_managed',
  'content.tenant_private',
]);
const TENANT_OPERATIONAL_POLICY_KEYS = new Set(['content.delivery_mode']);

type ResolvedValue = boolean | number | readonly string[] | null;

type TenantResolutionContext = {
  gymActive: boolean;
  subscription: any | null;
};

type LayerSource =
  | 'FAIL_CLOSED_DEFAULT'
  | 'PLAN_ENTITLEMENT'
  | 'TENANT_CONFIGURATION'
  | 'USER_PREFERENCE';

type EffectiveResolution = {
  featureKey: string;
  kind: ProductFeatureDefinition['kind'];
  value: ResolvedValue;
  source: LayerSource;
  reason: string | null;
  subscriptionId: string | null;
  plan: {
    code: string;
    version: number;
    status: ProductPlanVersionStatus;
  } | null;
  tenantConfigurationId: string | null;
  userPreferenceId: string | null;
};

type StoredLayerValue = {
  value: ResolvedValue;
  data: {
    kind: ProductEntitlementKind;
    featureEnabled: boolean | null;
    limitValue: number | null;
    policyValues: Prisma.InputJsonValue | typeof Prisma.DbNull;
  };
};

@Injectable()
export class TenantProductEntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly capabilities: ProductCapabilityCatalogService,
  ) {}

  private requireGymId(gymId?: string): string {
    if (!gymId?.trim()) {
      throw new BadRequestException('Tenant ativo obrigatorio para resolver entitlements');
    }
    return gymId;
  }

  private requireUserId(userId?: string): string {
    if (!userId?.trim()) {
      throw new BadRequestException('Usuario autenticado obrigatorio');
    }
    return userId;
  }

  private kindForDefinition(
    definition: Readonly<ProductFeatureDefinition>,
  ): ProductEntitlementKind {
    if (definition.kind === 'FEATURE') return ProductEntitlementKind.FEATURE;
    if (definition.kind === 'LIMIT') return ProductEntitlementKind.LIMIT;
    return ProductEntitlementKind.POLICY;
  }

  private assertTenantOperationalPreference(definition: Readonly<ProductFeatureDefinition>): void {
    const allowed =
      (definition.kind === 'FEATURE' && TENANT_OPERATIONAL_FEATURE_KEYS.has(definition.key)) ||
      (definition.kind === 'POLICY' && TENANT_OPERATIONAL_POLICY_KEYS.has(definition.key));
    if (!allowed) {
      throw new ForbiddenException(
        'Direitos e limites comerciais sao geridos pela FM Tecnologia. ' +
          'Configure a operacao no modulo proprio ou consulte o plano.',
      );
    }
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
    throw new ConflictException('Falha de concorrencia em product entitlements');
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

  private extractConfiguredValue(
    record: any,
    definition: Readonly<ProductFeatureDefinition>,
  ): { valid: true; value: ResolvedValue } | { valid: false } {
    if (
      definition.kind === 'FEATURE' &&
      record.kind === ProductEntitlementKind.FEATURE &&
      typeof record.featureEnabled === 'boolean' &&
      record.limitValue === null &&
      record.policyValues === null
    ) {
      return { valid: true, value: record.featureEnabled };
    }

    if (
      definition.kind === 'LIMIT' &&
      record.kind === ProductEntitlementKind.LIMIT &&
      record.featureEnabled === null &&
      Number.isInteger(record.limitValue) &&
      (record.limitValue ?? -1) >= 0 &&
      record.policyValues === null
    ) {
      return { valid: true, value: record.limitValue as number };
    }

    if (
      definition.kind === 'POLICY' &&
      record.kind === ProductEntitlementKind.POLICY &&
      record.featureEnabled === null &&
      record.limitValue === null &&
      Array.isArray(record.policyValues)
    ) {
      const raw = record.policyValues as unknown[];
      const values = raw.filter((value): value is string => typeof value === 'string');
      const allowed = new Set(definition.allowedPolicyValues ?? []);
      if (
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
  ): EffectiveResolution {
    return {
      featureKey: definition.key,
      kind: definition.kind,
      value: definition.failClosedDefault,
      source: 'FAIL_CLOSED_DEFAULT',
      reason,
      subscriptionId: subscription?.id ?? null,
      plan: subscription
        ? {
            code: subscription.planVersion.productPlan.code,
            version: subscription.planVersion.version,
            status: subscription.planVersion.status,
          }
        : null,
      tenantConfigurationId: null,
      userPreferenceId: null,
    };
  }

  private failClosedFromResolution(
    definition: Readonly<ProductFeatureDefinition>,
    parent: EffectiveResolution,
    reason: string,
  ): EffectiveResolution {
    return {
      ...parent,
      value: definition.failClosedDefault,
      source: 'FAIL_CLOSED_DEFAULT',
      reason,
    };
  }

  private resolvePlanFromContext(
    definition: Readonly<ProductFeatureDefinition>,
    context: TenantResolutionContext,
  ): EffectiveResolution {
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
      source: 'PLAN_ENTITLEMENT',
      reason: null,
      subscriptionId: subscription.id,
      plan: {
        code: subscription.planVersion.productPlan.code,
        version: subscription.planVersion.version,
        status: subscription.planVersion.status,
      },
      tenantConfigurationId: null,
      userPreferenceId: null,
    };
  }

  private isNarrowingAllowed(
    definition: Readonly<ProductFeatureDefinition>,
    parentValue: ResolvedValue,
    requestedValue: ResolvedValue,
  ): boolean {
    if (
      definition.kind === 'FEATURE' &&
      typeof parentValue === 'boolean' &&
      typeof requestedValue === 'boolean'
    ) {
      return canNarrowFeature(parentValue, requestedValue);
    }

    if (
      definition.kind === 'LIMIT' &&
      typeof parentValue === 'number' &&
      typeof requestedValue === 'number'
    ) {
      return canNarrowLimit(parentValue, requestedValue);
    }

    if (
      definition.kind === 'POLICY' &&
      Array.isArray(parentValue) &&
      Array.isArray(requestedValue)
    ) {
      return canNarrowPolicy(
        parentValue.filter((value): value is string => typeof value === 'string'),
        requestedValue.filter((value): value is string => typeof value === 'string'),
      );
    }

    return false;
  }

  private applyConfigurationLayer(
    definition: Readonly<ProductFeatureDefinition>,
    parent: EffectiveResolution,
    record: any | null,
    source: 'TENANT_CONFIGURATION' | 'USER_PREFERENCE',
  ): EffectiveResolution {
    if (!record || parent.source === 'FAIL_CLOSED_DEFAULT') return parent;

    const extracted = this.extractConfiguredValue(record, definition);
    if (!extracted.valid) {
      return this.failClosedFromResolution(
        definition,
        parent,
        source === 'TENANT_CONFIGURATION'
          ? 'INVALID_TENANT_CONFIGURATION'
          : 'INVALID_USER_PREFERENCE',
      );
    }

    if (!this.isNarrowingAllowed(definition, parent.value, extracted.value)) {
      return this.failClosedFromResolution(
        definition,
        parent,
        source === 'TENANT_CONFIGURATION'
          ? 'TENANT_CONFIGURATION_EXCEEDS_PLAN'
          : 'USER_PREFERENCE_EXCEEDS_TENANT_CONFIGURATION',
      );
    }

    return {
      ...parent,
      value: extracted.value,
      source,
      reason: null,
      tenantConfigurationId:
        source === 'TENANT_CONFIGURATION'
          ? record.id
          : parent.tenantConfigurationId,
      userPreferenceId:
        source === 'USER_PREFERENCE' ? record.id : parent.userPreferenceId,
    };
  }

  private buildStoredLayerValue(
    definition: Readonly<ProductFeatureDefinition>,
    dto: SetProductConfigurationValueDto,
  ): StoredLayerValue {
    if (definition.kind === 'FEATURE') {
      if (
        typeof dto.featureEnabled !== 'boolean' ||
        dto.limitValue !== undefined ||
        dto.policyValues !== undefined
      ) {
        throw new BadRequestException(
          `FEATURE ${definition.key} exige somente featureEnabled boolean`,
        );
      }
      return {
        value: dto.featureEnabled,
        data: {
          kind: ProductEntitlementKind.FEATURE,
          featureEnabled: dto.featureEnabled,
          limitValue: null,
          policyValues: Prisma.DbNull,
        },
      };
    }

    if (definition.kind === 'LIMIT') {
      if (
        !Number.isInteger(dto.limitValue) ||
        (dto.limitValue ?? -1) < 0 ||
        dto.featureEnabled !== undefined ||
        dto.policyValues !== undefined
      ) {
        throw new BadRequestException(
          `LIMIT ${definition.key} exige somente limitValue inteiro nao negativo`,
        );
      }
      return {
        value: dto.limitValue as number,
        data: {
          kind: ProductEntitlementKind.LIMIT,
          featureEnabled: null,
          limitValue: dto.limitValue as number,
          policyValues: Prisma.DbNull,
        },
      };
    }

    if (
      dto.featureEnabled !== undefined ||
      dto.limitValue !== undefined ||
      !Array.isArray(dto.policyValues)
    ) {
      throw new BadRequestException(
        `POLICY ${definition.key} exige somente policyValues`,
      );
    }

    const values = [...dto.policyValues].sort();
    if (new Set(values).size !== values.length) {
      throw new BadRequestException(`POLICY ${definition.key} possui valores duplicados`);
    }
    const allowed = new Set(definition.allowedPolicyValues ?? []);
    if (values.some((value) => !allowed.has(value))) {
      throw new BadRequestException(`POLICY ${definition.key} contem valor nao autorizado`);
    }

    return {
      value: values,
      data: {
        kind: ProductEntitlementKind.POLICY,
        featureEnabled: null,
        limitValue: null,
        policyValues: values as Prisma.InputJsonValue,
      },
    };
  }

  private sameStoredValue(record: any, built: StoredLayerValue): boolean {
    if (!record) return false;
    if (record.kind !== built.data.kind) return false;
    if (record.featureEnabled !== built.data.featureEnabled) return false;
    if (record.limitValue !== built.data.limitValue) return false;

    if (built.data.kind !== ProductEntitlementKind.POLICY) {
      return record.policyValues === null;
    }

    const recordValues = Array.isArray(record.policyValues)
      ? [...record.policyValues].sort()
      : null;
    return JSON.stringify(recordValues) === JSON.stringify(built.value);
  }

  private auditValue(record: any | null) {
    if (!record) return null;
    return {
      featureKey: record.featureKey,
      kind: record.kind,
      featureEnabled: record.featureEnabled,
      limitValue: record.limitValue,
      policyValues: record.policyValues,
    };
  }

  private async loadResolutionContext(
    gymId: string,
    db: any = this.prisma,
  ): Promise<TenantResolutionContext> {
    const gym = await db.gym.findUnique({
      where: { id: gymId },
      select: { id: true, active: true },
    });
    if (!gym?.active) return { gymActive: false, subscription: null };

    const subscription = await db.tenantProductSubscription.findFirst({
      where: {
        gymId,
        status: TenantProductSubscriptionStatus.ACTIVE,
        effectiveFrom: { lte: new Date() },
        OR: [
          { effectiveUntil: null },
          { effectiveUntil: { gt: new Date() } },
        ],
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

  private async loadTenantConfiguration(
    db: any,
    gymId: string,
    featureKey: string,
  ) {
    if (!db.tenantProductConfiguration?.findUnique) return null;
    return db.tenantProductConfiguration.findUnique({
      where: { gymId_featureKey: { gymId, featureKey } },
    });
  }

  private async loadTenantConfigurations(db: any, gymId: string) {
    if (!db.tenantProductConfiguration?.findMany) return [];
    return db.tenantProductConfiguration.findMany({
      where: { gymId },
      orderBy: { featureKey: 'asc' },
    });
  }

  private async loadUserPreference(
    db: any,
    gymId: string,
    userId: string,
    featureKey: string,
  ) {
    if (!db.userProductPreference?.findUnique) return null;
    return db.userProductPreference.findUnique({
      where: { gymId_userId_featureKey: { gymId, userId, featureKey } },
    });
  }

  private async loadUserPreferences(db: any, gymId: string, userId: string) {
    if (!db.userProductPreference?.findMany) return [];
    return db.userProductPreference.findMany({
      where: { gymId, userId },
      orderBy: { featureKey: 'asc' },
    });
  }

  private async assertStudentInTenant(db: any, gymId: string, userId: string) {
    const student = await db.student.findFirst({
      where: { gymId, userId },
      select: { id: true },
    });
    if (!student) {
      throw new ForbiddenException('Preferencia restrita ao aluno do tenant ativo');
    }
    return student;
  }

  private async resolveTenantFeatureWithDb(
    db: any,
    gymId: string,
    definition: Readonly<ProductFeatureDefinition>,
  ): Promise<EffectiveResolution> {
    const context = await this.loadResolutionContext(gymId, db);
    const planResolution = this.resolvePlanFromContext(definition, context);
    const configuration = await this.loadTenantConfiguration(
      db,
      gymId,
      definition.key,
    );
    return this.applyConfigurationLayer(
      definition,
      planResolution,
      configuration,
      'TENANT_CONFIGURATION',
    );
  }

  private async resolveUserFeatureWithDb(
    db: any,
    gymId: string,
    userId: string,
    definition: Readonly<ProductFeatureDefinition>,
  ): Promise<EffectiveResolution> {
    const tenantResolution = await this.resolveTenantFeatureWithDb(
      db,
      gymId,
      definition,
    );
    const preference = await this.loadUserPreference(
      db,
      gymId,
      userId,
      definition.key,
    );
    return this.applyConfigurationLayer(
      definition,
      tenantResolution,
      preference,
      'USER_PREFERENCE',
    );
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

  async listTenantConfigurations(gymId?: string) {
    const scopedGymId = this.requireGymId(gymId);
    const context = await this.loadResolutionContext(scopedGymId);
    if (!context.gymActive) throw new NotFoundException('Tenant ativo nao encontrado');
    return this.loadTenantConfigurations(this.prisma, scopedGymId);
  }

  async setTenantConfiguration(
    gymId: string | undefined,
    featureKey: string,
    dto: SetProductConfigurationValueDto,
    actorUserId?: string,
  ) {
    const scopedGymId = this.requireGymId(gymId);
    const definition = await this.capabilities.requireForResolution(featureKey);
    this.assertTenantOperationalPreference(definition);
    const built = this.buildStoredLayerValue(definition, dto);

    return this.serializable(async (tx) => {
      const context = await this.loadResolutionContext(scopedGymId, tx);
      const parent = this.resolvePlanFromContext(definition, context);
      if (parent.source === 'FAIL_CLOSED_DEFAULT') {
        throw new ConflictException(
          `Capability ${featureKey} nao esta disponivel no plano efetivo`,
        );
      }
      if (!this.isNarrowingAllowed(definition, parent.value, built.value)) {
        throw new ConflictException(
          `Configuracao do tenant nao pode ampliar ${featureKey} alem do plano`,
        );
      }

      const existing = await tx.tenantProductConfiguration.findUnique({
        where: { gymId_featureKey: { gymId: scopedGymId, featureKey } },
      });
      if (this.sameStoredValue(existing, built)) return existing;

      const record = await tx.tenantProductConfiguration.upsert({
        where: { gymId_featureKey: { gymId: scopedGymId, featureKey } },
        create: {
          gymId: scopedGymId,
          featureKey,
          ...built.data,
        },
        update: built.data,
      });

      await this.audit.record(
        {
          gymId: scopedGymId,
          userId: actorUserId ?? null,
          action: 'TENANT_PRODUCT_CONFIGURATION_SET',
          entity: 'TenantProductConfiguration',
          entityId: record.id,
          previous: this.auditValue(existing),
          next: this.auditValue(record),
        },
        tx,
      );

      return record;
    });
  }

  async resetTenantConfiguration(
    gymId: string | undefined,
    featureKey: string,
    actorUserId?: string,
  ) {
    const scopedGymId = this.requireGymId(gymId);
    const definition = await this.capabilities.requireForResolution(featureKey);
    this.assertTenantOperationalPreference(definition);

    return this.serializable(async (tx) => {
      const existing = await tx.tenantProductConfiguration.findUnique({
        where: { gymId_featureKey: { gymId: scopedGymId, featureKey } },
      });
      if (!existing) return { removed: false, featureKey };

      await tx.tenantProductConfiguration.delete({ where: { id: existing.id } });
      await this.audit.record(
        {
          gymId: scopedGymId,
          userId: actorUserId ?? null,
          action: 'TENANT_PRODUCT_CONFIGURATION_RESET',
          entity: 'TenantProductConfiguration',
          entityId: existing.id,
          previous: this.auditValue(existing),
          next: null,
        },
        tx,
      );
      return { removed: true, featureKey };
    });
  }

  async listUserPreferences(gymId: string | undefined, userId?: string) {
    const scopedGymId = this.requireGymId(gymId);
    const scopedUserId = this.requireUserId(userId);
    await this.assertStudentInTenant(this.prisma, scopedGymId, scopedUserId);
    return this.loadUserPreferences(this.prisma, scopedGymId, scopedUserId);
  }

  async setUserPreference(
    gymId: string | undefined,
    userId: string | undefined,
    featureKey: string,
    dto: SetProductConfigurationValueDto,
  ) {
    const scopedGymId = this.requireGymId(gymId);
    const scopedUserId = this.requireUserId(userId);
    const definition = await this.capabilities.requireForResolution(featureKey);
    const built = this.buildStoredLayerValue(definition, dto);

    return this.serializable(async (tx) => {
      await this.assertStudentInTenant(tx, scopedGymId, scopedUserId);
      const parent = await this.resolveTenantFeatureWithDb(
        tx,
        scopedGymId,
        definition,
      );
      if (parent.source === 'FAIL_CLOSED_DEFAULT') {
        throw new ConflictException(
          `Capability ${featureKey} nao esta disponivel para preferencia`,
        );
      }
      if (!this.isNarrowingAllowed(definition, parent.value, built.value)) {
        throw new ConflictException(
          `Preferencia do aluno nao pode ampliar ${featureKey} alem da configuracao do tenant`,
        );
      }

      const existing = await tx.userProductPreference.findUnique({
        where: {
          gymId_userId_featureKey: {
            gymId: scopedGymId,
            userId: scopedUserId,
            featureKey,
          },
        },
      });
      if (this.sameStoredValue(existing, built)) return existing;

      const record = await tx.userProductPreference.upsert({
        where: {
          gymId_userId_featureKey: {
            gymId: scopedGymId,
            userId: scopedUserId,
            featureKey,
          },
        },
        create: {
          gymId: scopedGymId,
          userId: scopedUserId,
          featureKey,
          ...built.data,
        },
        update: built.data,
      });

      await this.audit.record(
        {
          gymId: scopedGymId,
          userId: scopedUserId,
          action: 'USER_PRODUCT_PREFERENCE_SET',
          entity: 'UserProductPreference',
          entityId: record.id,
          previous: this.auditValue(existing),
          next: this.auditValue(record),
        },
        tx,
      );

      return record;
    });
  }

  async resetUserPreference(
    gymId: string | undefined,
    userId: string | undefined,
    featureKey: string,
  ) {
    const scopedGymId = this.requireGymId(gymId);
    const scopedUserId = this.requireUserId(userId);
    await this.capabilities.requireForResolution(featureKey);

    return this.serializable(async (tx) => {
      await this.assertStudentInTenant(tx, scopedGymId, scopedUserId);
      const existing = await tx.userProductPreference.findUnique({
        where: {
          gymId_userId_featureKey: {
            gymId: scopedGymId,
            userId: scopedUserId,
            featureKey,
          },
        },
      });
      if (!existing) return { removed: false, featureKey };

      await tx.userProductPreference.delete({ where: { id: existing.id } });
      await this.audit.record(
        {
          gymId: scopedGymId,
          userId: scopedUserId,
          action: 'USER_PRODUCT_PREFERENCE_RESET',
          entity: 'UserProductPreference',
          entityId: existing.id,
          previous: this.auditValue(existing),
          next: null,
        },
        tx,
      );
      return { removed: true, featureKey };
    });
  }

  async resolveFeature(gymId: string | undefined, featureKey: string) {
    const scopedGymId = this.requireGymId(gymId);
    const definition = await this.capabilities.requireForResolution(featureKey);
    return this.resolveTenantFeatureWithDb(this.prisma, scopedGymId, definition);
  }

  async resolveAll(gymId?: string) {
    const scopedGymId = this.requireGymId(gymId);
    const [context, configurations, definitions] = await Promise.all([
      this.loadResolutionContext(scopedGymId),
      this.loadTenantConfigurations(this.prisma, scopedGymId),
      this.capabilities.listForResolution(),
    ]);
    const byFeature = new Map(
      configurations.map((record: any) => [record.featureKey, record]),
    );

    return definitions.map((definition) => {
      const planResolution = this.resolvePlanFromContext(definition, context);
      const effective = this.applyConfigurationLayer(
        definition,
        planResolution,
        byFeature.get(definition.key) ?? null,
        'TENANT_CONFIGURATION',
      );
      return {
        ...effective,
        planValue: planResolution.value,
        definition: {
          domain: definition.domain,
          description: definition.description,
          allowedPolicyValues: definition.allowedPolicyValues
            ? [...definition.allowedPolicyValues]
            : null,
        },
      };
    });
  }

  async resolveFeatureForUser(
    gymId: string | undefined,
    userId: string | undefined,
    featureKey: string,
  ) {
    const scopedGymId = this.requireGymId(gymId);
    const scopedUserId = this.requireUserId(userId);
    const definition = await this.capabilities.requireForResolution(featureKey);
    await this.assertStudentInTenant(this.prisma, scopedGymId, scopedUserId);
    return this.resolveUserFeatureWithDb(
      this.prisma,
      scopedGymId,
      scopedUserId,
      definition,
    );
  }

  async resolveAllForUser(gymId: string | undefined, userId?: string) {
    const scopedGymId = this.requireGymId(gymId);
    const scopedUserId = this.requireUserId(userId);
    await this.assertStudentInTenant(this.prisma, scopedGymId, scopedUserId);

    const [context, configurations, preferences, definitions] = await Promise.all([
      this.loadResolutionContext(scopedGymId),
      this.loadTenantConfigurations(this.prisma, scopedGymId),
      this.loadUserPreferences(this.prisma, scopedGymId, scopedUserId),
      this.capabilities.listForResolution(),
    ]);
    const configByFeature = new Map(
      configurations.map((record: any) => [record.featureKey, record]),
    );
    const preferenceByFeature = new Map(
      preferences.map((record: any) => [record.featureKey, record]),
    );

    return definitions.map((definition) => {
      const planResolution = this.resolvePlanFromContext(definition, context);
      const tenantResolution = this.applyConfigurationLayer(
        definition,
        planResolution,
        configByFeature.get(definition.key) ?? null,
        'TENANT_CONFIGURATION',
      );
      return this.applyConfigurationLayer(
        definition,
        tenantResolution,
        preferenceByFeature.get(definition.key) ?? null,
        'USER_PREFERENCE',
      );
    });
  }
}
