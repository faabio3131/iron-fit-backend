import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PRODUCT_FEATURE_CATALOG_V1,
  ProductFeatureDefinition,
  canNarrowFeature,
  canNarrowLimit,
  canNarrowPolicy,
} from './contracts/product-entitlement-contract';
import { SetProductConfigurationDto } from './dto/set-product-configuration.dto';
import { TenantProductEntitlementsService } from './tenant-product-entitlements.service';

const SERIALIZABLE_ATTEMPTS = 3;

type LayerValue = boolean | number | readonly string[];

type StoredLayerRow = {
  id: string;
  featureKey: string;
  kind: 'FEATURE' | 'LIMIT' | 'POLICY';
  featureEnabled: boolean | null;
  limitValue: number | null;
  policyValues: Prisma.JsonValue | null;
};

@Injectable()
export class TenantProductConfigurationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenantEntitlements: TenantProductEntitlementsService,
  ) {}

  private requireGymId(gymId?: string): string {
    if (!gymId?.trim()) {
      throw new BadRequestException('Tenant ativo obrigatorio para configuracao de produto');
    }
    return gymId;
  }

  private requireUserId(userId?: string): string {
    if (!userId?.trim()) {
      throw new BadRequestException('Usuario autenticado obrigatorio');
    }
    return userId;
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
    throw new ConflictException('Falha de concorrencia ao configurar experiencia do tenant');
  }

  private requestedValue(
    definition: Readonly<ProductFeatureDefinition>,
    dto: SetProductConfigurationDto,
  ): LayerValue {
    if (dto.kind !== definition.kind) {
      throw new BadRequestException('kind nao corresponde a capability canonica');
    }

    if (
      definition.kind === 'FEATURE' &&
      typeof dto.featureEnabled === 'boolean' &&
      dto.limitValue === undefined &&
      dto.policyValues === undefined
    ) {
      return dto.featureEnabled;
    }

    if (
      definition.kind === 'LIMIT' &&
      Number.isInteger(dto.limitValue) &&
      (dto.limitValue ?? -1) >= 0 &&
      dto.featureEnabled === undefined &&
      dto.policyValues === undefined
    ) {
      return dto.limitValue as number;
    }

    if (
      definition.kind === 'POLICY' &&
      dto.featureEnabled === undefined &&
      dto.limitValue === undefined &&
      Array.isArray(dto.policyValues) &&
      dto.policyValues.length > 0
    ) {
      const values = dto.policyValues;
      const allowed = new Set(definition.allowedPolicyValues ?? []);
      if (
        new Set(values).size === values.length &&
        values.every((value) => allowed.has(value))
      ) {
        return [...values];
      }
    }

    throw new BadRequestException('Valor de configuracao invalido para a capability');
  }

  private storedValue(
    definition: Readonly<ProductFeatureDefinition>,
    row: StoredLayerRow,
  ): LayerValue | null {
    if (row.featureKey !== definition.key || row.kind !== definition.kind) return null;

    if (
      definition.kind === 'FEATURE' &&
      typeof row.featureEnabled === 'boolean' &&
      row.limitValue === null &&
      row.policyValues === null
    ) {
      return row.featureEnabled;
    }

    if (
      definition.kind === 'LIMIT' &&
      row.featureEnabled === null &&
      Number.isInteger(row.limitValue) &&
      (row.limitValue ?? -1) >= 0 &&
      row.policyValues === null
    ) {
      return row.limitValue as number;
    }

    if (
      definition.kind === 'POLICY' &&
      row.featureEnabled === null &&
      row.limitValue === null &&
      Array.isArray(row.policyValues)
    ) {
      const raw = row.policyValues as unknown[];
      const values = raw.filter((value): value is string => typeof value === 'string');
      const allowed = new Set(definition.allowedPolicyValues ?? []);
      if (
        values.length > 0 &&
        values.length === raw.length &&
        new Set(values).size === values.length &&
        values.every((value) => allowed.has(value))
      ) {
        return [...values];
      }
    }

    return null;
  }

  private canNarrow(
    definition: Readonly<ProductFeatureDefinition>,
    upperValue: unknown,
    requested: LayerValue,
  ): boolean {
    if (
      definition.kind === 'FEATURE' &&
      typeof upperValue === 'boolean' &&
      typeof requested === 'boolean'
    ) {
      return canNarrowFeature(upperValue, requested);
    }
    if (
      definition.kind === 'LIMIT' &&
      typeof upperValue === 'number' &&
      typeof requested === 'number'
    ) {
      return canNarrowLimit(upperValue, requested);
    }
    if (
      definition.kind === 'POLICY' &&
      Array.isArray(upperValue) &&
      Array.isArray(requested)
    ) {
      return canNarrowPolicy(upperValue as string[], requested as string[]);
    }
    return false;
  }

  private failClosed(
    definition: Readonly<ProductFeatureDefinition>,
    reason: string,
    upper: any,
  ) {
    return {
      ...upper,
      featureKey: definition.key,
      kind: definition.kind,
      value: definition.failClosedDefault,
      source: 'FAIL_CLOSED_DEFAULT' as const,
      reason,
      configurationId: null,
      preferenceId: null,
    };
  }

  private async tenantConfiguration(
    gymId: string,
    featureKey: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<StoredLayerRow | null> {
    const rows = await db.$queryRaw<StoredLayerRow[]>(Prisma.sql`
      SELECT "id", "featureKey", "kind", "featureEnabled", "limitValue", "policyValues"
      FROM "TenantProductConfiguration"
      WHERE "gymId" = ${gymId} AND "featureKey" = ${featureKey}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  private async studentPreference(
    studentId: string,
    featureKey: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<StoredLayerRow | null> {
    const rows = await db.$queryRaw<StoredLayerRow[]>(Prisma.sql`
      SELECT "id", "featureKey", "kind", "featureEnabled", "limitValue", "policyValues"
      FROM "StudentProductPreference"
      WHERE "studentId" = ${studentId} AND "featureKey" = ${featureKey}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  private async activeStudent(gymId: string, userId: string) {
    const student = await this.prisma.student.findFirst({
      where: { gymId, userId, status: 'ACTIVE' },
      select: { id: true, gymId: true, userId: true, status: true },
    });
    if (!student) {
      throw new NotFoundException('Aluno ativo nao encontrado no tenant autenticado');
    }
    return student;
  }

  async resolveTenantFeature(gymId: string | undefined, featureKey: string) {
    const scopedGymId = this.requireGymId(gymId);
    const definition = this.featureDefinition(featureKey);
    const plan = await this.tenantEntitlements.resolveFeature(scopedGymId, featureKey);
    if (plan.source !== 'PLAN_ENTITLEMENT') return plan;

    const configuration = await this.tenantConfiguration(scopedGymId, featureKey);
    if (!configuration) return plan;

    const value = this.storedValue(definition, configuration);
    if (value === null || !this.canNarrow(definition, plan.value, value)) {
      return this.failClosed(definition, 'INVALID_TENANT_CONFIGURATION', plan);
    }

    return {
      ...plan,
      value,
      source: 'TENANT_CONFIGURATION' as const,
      reason: null,
      configurationId: configuration.id,
      preferenceId: null,
    };
  }

  async resolveTenantAll(gymId?: string) {
    const scopedGymId = this.requireGymId(gymId);
    return Promise.all(
      PRODUCT_FEATURE_CATALOG_V1.map((definition) =>
        this.resolveTenantFeature(scopedGymId, definition.key),
      ),
    );
  }

  async setTenantConfiguration(
    gymId: string | undefined,
    featureKey: string,
    dto: SetProductConfigurationDto,
    actorUserId?: string,
  ) {
    const scopedGymId = this.requireGymId(gymId);
    const definition = this.featureDefinition(featureKey);
    const value = this.requestedValue(definition, dto);
    const plan = await this.tenantEntitlements.resolveFeature(scopedGymId, featureKey);

    if (plan.source !== 'PLAN_ENTITLEMENT') {
      throw new ConflictException('Capability nao concedida pelo plano efetivo');
    }
    if (!this.canNarrow(definition, plan.value, value)) {
      throw new ConflictException('Configuracao tenant nao pode ampliar entitlement do plano');
    }

    return this.serializable(async (tx) => {
      const previous = await this.tenantConfiguration(scopedGymId, featureKey, tx);
      const id = previous?.id ?? randomUUID();
      const featureEnabled = definition.kind === 'FEATURE' ? (value as boolean) : null;
      const limitValue = definition.kind === 'LIMIT' ? (value as number) : null;
      const policySql =
        definition.kind === 'POLICY'
          ? Prisma.sql`CAST(${JSON.stringify(value)} AS jsonb)`
          : Prisma.sql`NULL`;

      const rows = await tx.$queryRaw<StoredLayerRow[]>(Prisma.sql`
        INSERT INTO "TenantProductConfiguration"
          ("id", "gymId", "featureKey", "kind", "featureEnabled", "limitValue", "policyValues", "createdAt", "updatedAt")
        VALUES
          (${id}, ${scopedGymId}, ${featureKey}, ${definition.kind}::"ProductEntitlementKind", ${featureEnabled}, ${limitValue}, ${policySql}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("gymId", "featureKey") DO UPDATE SET
          "kind" = EXCLUDED."kind",
          "featureEnabled" = EXCLUDED."featureEnabled",
          "limitValue" = EXCLUDED."limitValue",
          "policyValues" = EXCLUDED."policyValues",
          "updatedAt" = CURRENT_TIMESTAMP
        RETURNING "id", "featureKey", "kind", "featureEnabled", "limitValue", "policyValues"
      `);
      const next = rows[0];

      await this.audit.record(
        {
          gymId: scopedGymId,
          userId: actorUserId ?? null,
          action: 'TENANT_PRODUCT_CONFIGURATION_SET',
          entity: 'TenantProductConfiguration',
          entityId: next.id,
          previous,
          next,
        },
        tx,
      );

      return next;
    });
  }

  async deleteTenantConfiguration(
    gymId: string | undefined,
    featureKey: string,
    actorUserId?: string,
  ) {
    const scopedGymId = this.requireGymId(gymId);
    this.featureDefinition(featureKey);

    return this.serializable(async (tx) => {
      const previous = await this.tenantConfiguration(scopedGymId, featureKey, tx);
      if (!previous) return { deleted: false };

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "TenantProductConfiguration"
        WHERE "gymId" = ${scopedGymId} AND "featureKey" = ${featureKey}
      `);
      await this.audit.record(
        {
          gymId: scopedGymId,
          userId: actorUserId ?? null,
          action: 'TENANT_PRODUCT_CONFIGURATION_CLEARED',
          entity: 'TenantProductConfiguration',
          entityId: previous.id,
          previous,
          next: null,
        },
        tx,
      );
      return { deleted: true };
    });
  }

  async resolveStudentFeature(
    gymId: string | undefined,
    userId: string | undefined,
    featureKey: string,
  ) {
    const scopedGymId = this.requireGymId(gymId);
    const scopedUserId = this.requireUserId(userId);
    const definition = this.featureDefinition(featureKey);
    const student = await this.activeStudent(scopedGymId, scopedUserId);
    const tenant = await this.resolveTenantFeature(scopedGymId, featureKey);
    if (tenant.source === 'FAIL_CLOSED_DEFAULT') return tenant;

    const preference = await this.studentPreference(student.id, featureKey);
    if (!preference) return { ...tenant, studentId: student.id };

    const value = this.storedValue(definition, preference);
    if (value === null || !this.canNarrow(definition, tenant.value, value)) {
      return {
        ...this.failClosed(definition, 'INVALID_STUDENT_PREFERENCE', tenant),
        studentId: student.id,
      };
    }

    return {
      ...tenant,
      value,
      source: 'USER_PREFERENCE' as const,
      reason: null,
      preferenceId: preference.id,
      studentId: student.id,
    };
  }

  async resolveStudentAll(gymId?: string, userId?: string) {
    const scopedGymId = this.requireGymId(gymId);
    const scopedUserId = this.requireUserId(userId);
    return Promise.all(
      PRODUCT_FEATURE_CATALOG_V1.map((definition) =>
        this.resolveStudentFeature(scopedGymId, scopedUserId, definition.key),
      ),
    );
  }

  async setStudentPreference(
    gymId: string | undefined,
    userId: string | undefined,
    featureKey: string,
    dto: SetProductConfigurationDto,
  ) {
    const scopedGymId = this.requireGymId(gymId);
    const scopedUserId = this.requireUserId(userId);
    const definition = this.featureDefinition(featureKey);
    const value = this.requestedValue(definition, dto);
    const student = await this.activeStudent(scopedGymId, scopedUserId);
    const tenant = await this.resolveTenantFeature(scopedGymId, featureKey);

    if (tenant.source === 'FAIL_CLOSED_DEFAULT') {
      throw new ConflictException('Capability nao disponivel na experiencia efetiva do tenant');
    }
    if (!this.canNarrow(definition, tenant.value, value)) {
      throw new ConflictException('Preferencia do aluno nao pode ampliar configuracao do tenant');
    }

    return this.serializable(async (tx) => {
      const previous = await this.studentPreference(student.id, featureKey, tx);
      const id = previous?.id ?? randomUUID();
      const featureEnabled = definition.kind === 'FEATURE' ? (value as boolean) : null;
      const limitValue = definition.kind === 'LIMIT' ? (value as number) : null;
      const policySql =
        definition.kind === 'POLICY'
          ? Prisma.sql`CAST(${JSON.stringify(value)} AS jsonb)`
          : Prisma.sql`NULL`;

      const rows = await tx.$queryRaw<StoredLayerRow[]>(Prisma.sql`
        INSERT INTO "StudentProductPreference"
          ("id", "studentId", "featureKey", "kind", "featureEnabled", "limitValue", "policyValues", "createdAt", "updatedAt")
        VALUES
          (${id}, ${student.id}, ${featureKey}, ${definition.kind}::"ProductEntitlementKind", ${featureEnabled}, ${limitValue}, ${policySql}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("studentId", "featureKey") DO UPDATE SET
          "kind" = EXCLUDED."kind",
          "featureEnabled" = EXCLUDED."featureEnabled",
          "limitValue" = EXCLUDED."limitValue",
          "policyValues" = EXCLUDED."policyValues",
          "updatedAt" = CURRENT_TIMESTAMP
        RETURNING "id", "featureKey", "kind", "featureEnabled", "limitValue", "policyValues"
      `);
      const next = rows[0];

      await this.audit.record(
        {
          gymId: scopedGymId,
          userId: scopedUserId,
          action: 'STUDENT_PRODUCT_PREFERENCE_SET',
          entity: 'StudentProductPreference',
          entityId: next.id,
          previous,
          next,
        },
        tx,
      );

      return next;
    });
  }

  async deleteStudentPreference(
    gymId: string | undefined,
    userId: string | undefined,
    featureKey: string,
  ) {
    const scopedGymId = this.requireGymId(gymId);
    const scopedUserId = this.requireUserId(userId);
    this.featureDefinition(featureKey);
    const student = await this.activeStudent(scopedGymId, scopedUserId);

    return this.serializable(async (tx) => {
      const previous = await this.studentPreference(student.id, featureKey, tx);
      if (!previous) return { deleted: false };

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "StudentProductPreference"
        WHERE "studentId" = ${student.id} AND "featureKey" = ${featureKey}
      `);
      await this.audit.record(
        {
          gymId: scopedGymId,
          userId: scopedUserId,
          action: 'STUDENT_PRODUCT_PREFERENCE_CLEARED',
          entity: 'StudentProductPreference',
          entityId: previous.id,
          previous,
          next: null,
        },
        tx,
      );
      return { deleted: true };
    });
  }
}
