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
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  PRODUCT_FEATURE_CATALOG_V1,
  ProductFeatureDefinition,
} from './contracts/product-entitlement-contract';
import { CreateProductPlanDto } from './dto/create-product-plan.dto';
import { CreateProductPlanVersionDto } from './dto/create-product-plan-version.dto';
import { SetProductPlanEntitlementDto } from './dto/set-product-plan-entitlement.dto';

const SERIALIZABLE_ATTEMPTS = 3;

@Injectable()
export class ProductEntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
    throw new ConflictException('Falha de concorrencia ao governar plano');
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

  private buildEntitlementValue(
    dto: SetProductPlanEntitlementDto,
  ): {
    kind: ProductEntitlementKind;
    featureEnabled: boolean | null;
    limitValue: number | null;
    policyValues: Prisma.InputJsonValue | typeof Prisma.DbNull;
  } {
    const definition = this.featureDefinition(dto.featureKey);

    if (definition.kind === 'FEATURE') {
      if (
        typeof dto.featureEnabled !== 'boolean' ||
        dto.limitValue !== undefined ||
        dto.policyValues !== undefined
      ) {
        throw new BadRequestException(
          `FEATURE ${dto.featureKey} exige somente featureEnabled boolean`,
        );
      }
      return {
        kind: ProductEntitlementKind.FEATURE,
        featureEnabled: dto.featureEnabled,
        limitValue: null,
        policyValues: Prisma.DbNull,
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
          `LIMIT ${dto.featureKey} exige somente limitValue inteiro nao negativo`,
        );
      }
      return {
        kind: ProductEntitlementKind.LIMIT,
        featureEnabled: null,
        limitValue: dto.limitValue as number,
        policyValues: Prisma.DbNull,
      };
    }

    if (
      dto.featureEnabled !== undefined ||
      dto.limitValue !== undefined ||
      !Array.isArray(dto.policyValues) ||
      dto.policyValues.length === 0
    ) {
      throw new BadRequestException(
        `POLICY ${dto.featureKey} exige somente policyValues nao vazio`,
      );
    }

    const values = [...new Set(dto.policyValues)];
    if (values.length !== dto.policyValues.length) {
      throw new BadRequestException(`POLICY ${dto.featureKey} possui valores duplicados`);
    }
    const allowed = new Set(definition.allowedPolicyValues ?? []);
    if (values.some((value) => !allowed.has(value))) {
      throw new BadRequestException(`POLICY ${dto.featureKey} contem valor nao autorizado`);
    }

    return {
      kind: ProductEntitlementKind.POLICY,
      featureEnabled: null,
      limitValue: null,
      policyValues: values.sort() as Prisma.InputJsonValue,
    };
  }

  private validateStoredEntitlement(entitlement: ProductPlanEntitlement): void {
    const definition = this.featureDefinition(entitlement.featureKey);
    if (entitlement.kind !== definition.kind) {
      throw new BadRequestException(
        `Entitlement ${entitlement.featureKey} diverge do tipo canonico`,
      );
    }

    if (entitlement.kind === ProductEntitlementKind.FEATURE) {
      if (
        typeof entitlement.featureEnabled !== 'boolean' ||
        entitlement.limitValue !== null ||
        entitlement.policyValues !== null
      ) {
        throw new BadRequestException(`FEATURE ${entitlement.featureKey} possui shape invalido`);
      }
      return;
    }

    if (entitlement.kind === ProductEntitlementKind.LIMIT) {
      if (
        entitlement.featureEnabled !== null ||
        !Number.isInteger(entitlement.limitValue) ||
        (entitlement.limitValue ?? -1) < 0 ||
        entitlement.policyValues !== null
      ) {
        throw new BadRequestException(`LIMIT ${entitlement.featureKey} possui shape invalido`);
      }
      return;
    }

    const values = Array.isArray(entitlement.policyValues)
      ? entitlement.policyValues.filter((value): value is string => typeof value === 'string')
      : [];
    const allowed = new Set(definition.allowedPolicyValues ?? []);
    if (
      entitlement.featureEnabled !== null ||
      entitlement.limitValue !== null ||
      values.length === 0 ||
      values.length !== (entitlement.policyValues as unknown[]).length ||
      new Set(values).size !== values.length ||
      values.some((value) => !allowed.has(value))
    ) {
      throw new BadRequestException(`POLICY ${entitlement.featureKey} possui shape invalido`);
    }
  }

  async findPlans() {
    return this.prisma.productPlan.findMany({
      orderBy: { code: 'asc' },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          include: { entitlements: { orderBy: { featureKey: 'asc' } } },
        },
      },
    });
  }

  async createPlan(dto: CreateProductPlanDto, actorUserId?: string) {
    const name = dto.name.trim();
    const description = dto.description?.trim() || null;

    return this.serializable(async (tx) => {
      const existing = await tx.productPlan.findUnique({ where: { code: dto.code } });
      if (existing) {
        if (existing.name === name && existing.description === description) return existing;
        throw new ConflictException('planCode ja existe com definicao diferente');
      }

      const plan = await tx.productPlan.create({
        data: { code: dto.code, name, description },
      });
      await this.audit.record(
        {
          gymId: null,
          userId: actorUserId ?? null,
          action: 'PRODUCT_PLAN_CREATED',
          entity: 'ProductPlan',
          entityId: plan.id,
          next: { code: plan.code, name: plan.name, description: plan.description },
        },
        tx,
      );
      return plan;
    });
  }

  async createVersion(
    planId: string,
    dto: CreateProductPlanVersionDto,
    actorUserId?: string,
  ) {
    return this.serializable(async (tx) => {
      const plan = await tx.productPlan.findUnique({ where: { id: planId } });
      if (!plan) throw new NotFoundException('ProductPlan nao encontrado');

      const existing = await tx.productPlanVersion.findUnique({
        where: { productPlanId_version: { productPlanId: planId, version: dto.version } },
      });
      if (existing) return existing;

      const version = await tx.productPlanVersion.create({
        data: { productPlanId: planId, version: dto.version },
      });
      await this.audit.record(
        {
          gymId: null,
          userId: actorUserId ?? null,
          action: 'PRODUCT_PLAN_VERSION_CREATED',
          entity: 'ProductPlanVersion',
          entityId: version.id,
          next: { planCode: plan.code, version: version.version, status: version.status },
        },
        tx,
      );
      return version;
    });
  }

  async setEntitlement(
    planId: string,
    versionNumber: number,
    dto: SetProductPlanEntitlementDto,
    actorUserId?: string,
  ) {
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new BadRequestException('version deve ser inteiro positivo');
    }
    const value = this.buildEntitlementValue(dto);

    return this.serializable(async (tx) => {
      const version = await tx.productPlanVersion.findFirst({
        where: { productPlanId: planId, version: versionNumber },
        include: { productPlan: true },
      });
      if (!version) throw new NotFoundException('Versao de ProductPlan nao encontrada');
      if (version.status !== ProductPlanVersionStatus.DRAFT) {
        throw new ConflictException('Versao publicada/retirada e imutavel');
      }

      const previous = await tx.productPlanEntitlement.findUnique({
        where: {
          planVersionId_featureKey: {
            planVersionId: version.id,
            featureKey: dto.featureKey,
          },
        },
      });

      const entitlement = await tx.productPlanEntitlement.upsert({
        where: {
          planVersionId_featureKey: {
            planVersionId: version.id,
            featureKey: dto.featureKey,
          },
        },
        create: {
          planVersionId: version.id,
          featureKey: dto.featureKey,
          ...value,
        },
        update: value,
      });

      await this.audit.record(
        {
          gymId: null,
          userId: actorUserId ?? null,
          action: previous ? 'PRODUCT_PLAN_ENTITLEMENT_UPDATED' : 'PRODUCT_PLAN_ENTITLEMENT_CREATED',
          entity: 'ProductPlanEntitlement',
          entityId: entitlement.id,
          previous: previous
            ? {
                featureKey: previous.featureKey,
                kind: previous.kind,
                featureEnabled: previous.featureEnabled,
                limitValue: previous.limitValue,
                policyValues: previous.policyValues,
              }
            : undefined,
          next: {
            planCode: version.productPlan.code,
            version: version.version,
            featureKey: entitlement.featureKey,
            kind: entitlement.kind,
            featureEnabled: entitlement.featureEnabled,
            limitValue: entitlement.limitValue,
            policyValues: entitlement.policyValues,
          },
        },
        tx,
      );
      return entitlement;
    });
  }

  async publishVersion(planId: string, versionNumber: number, actorUserId?: string) {
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new BadRequestException('version deve ser inteiro positivo');
    }

    return this.serializable(async (tx) => {
      const version = await tx.productPlanVersion.findFirst({
        where: { productPlanId: planId, version: versionNumber },
        include: { productPlan: true, entitlements: true },
      });
      if (!version) throw new NotFoundException('Versao de ProductPlan nao encontrada');
      if (version.status === ProductPlanVersionStatus.PUBLISHED) return version;
      if (version.status === ProductPlanVersionStatus.RETIRED) {
        throw new ConflictException('Versao retirada nao pode ser republicada');
      }

      for (const entitlement of version.entitlements) {
        this.validateStoredEntitlement(entitlement);
      }

      const publishedAt = new Date();
      const published = await tx.productPlanVersion.update({
        where: { id: version.id },
        data: { status: ProductPlanVersionStatus.PUBLISHED, publishedAt },
        include: { productPlan: true, entitlements: { orderBy: { featureKey: 'asc' } } },
      });
      await this.audit.record(
        {
          gymId: null,
          userId: actorUserId ?? null,
          action: 'PRODUCT_PLAN_VERSION_PUBLISHED',
          entity: 'ProductPlanVersion',
          entityId: published.id,
          previous: { status: version.status, publishedAt: version.publishedAt },
          next: {
            planCode: published.productPlan.code,
            version: published.version,
            status: published.status,
            publishedAt: published.publishedAt,
            entitlementCount: published.entitlements.length,
          },
        },
        tx,
      );
      return published;
    });
  }

  async retireVersion(planId: string, versionNumber: number, actorUserId?: string) {
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new BadRequestException('version deve ser inteiro positivo');
    }

    return this.serializable(async (tx) => {
      const version = await tx.productPlanVersion.findFirst({
        where: { productPlanId: planId, version: versionNumber },
        include: { productPlan: true },
      });
      if (!version) throw new NotFoundException('Versao de ProductPlan nao encontrada');
      if (version.status === ProductPlanVersionStatus.RETIRED) return version;
      if (version.status !== ProductPlanVersionStatus.PUBLISHED) {
        throw new ConflictException('Somente versao publicada pode ser retirada');
      }

      const retiredAt = new Date();
      const retired = await tx.productPlanVersion.update({
        where: { id: version.id },
        data: { status: ProductPlanVersionStatus.RETIRED, retiredAt },
        include: { productPlan: true },
      });
      await this.audit.record(
        {
          gymId: null,
          userId: actorUserId ?? null,
          action: 'PRODUCT_PLAN_VERSION_RETIRED',
          entity: 'ProductPlanVersion',
          entityId: retired.id,
          previous: { status: version.status, retiredAt: version.retiredAt },
          next: {
            planCode: retired.productPlan.code,
            version: retired.version,
            status: retired.status,
            retiredAt: retired.retiredAt,
          },
        },
        tx,
      );
      return retired;
    });
  }
}
