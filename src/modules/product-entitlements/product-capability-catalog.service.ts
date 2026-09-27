import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductCapabilityDefinition,
  ProductCapabilityStatus,
  ProductEntitlementKind,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  defineProductFeature,
  ProductFeatureDefinition,
} from './contracts/product-entitlement-contract';
import { CreateProductCapabilityDto } from './dto/create-product-capability.dto';

type CapabilityDb = PrismaService | Prisma.TransactionClient;
const SERIALIZABLE_ATTEMPTS = 3;

function failClosedDefault(
  kind: ProductEntitlementKind | 'FEATURE' | 'LIMIT' | 'POLICY',
): false | 0 | null {
  if (kind === 'FEATURE') return false;
  if (kind === 'LIMIT') return 0;
  return null;
}

function policyValues(record: Pick<ProductCapabilityDefinition, 'allowedPolicyValues'>): string[] | undefined {
  if (record.allowedPolicyValues === null) return undefined;
  if (!Array.isArray(record.allowedPolicyValues)) {
    throw new BadRequestException('Capability POLICY possui allowedPolicyValues invalido');
  }
  const values = record.allowedPolicyValues.filter(
    (value): value is string => typeof value === 'string',
  );
  if (values.length !== record.allowedPolicyValues.length) {
    throw new BadRequestException('Capability POLICY possui allowedPolicyValues invalido');
  }
  return values;
}

@Injectable()
export class ProductCapabilityCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private definition(
    record: ProductCapabilityDefinition,
  ): Readonly<ProductFeatureDefinition> {
    return defineProductFeature({
      key: record.key,
      kind: record.kind,
      domain: record.domain,
      description: record.description,
      failClosedDefault: failClosedDefault(record.kind),
      allowedPolicyValues: policyValues(record),
    });
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
    throw new ConflictException('Falha de concorrencia no catalogo de capabilities');
  }

  async requireForResolution(
    key: string,
    db: CapabilityDb = this.prisma,
  ): Promise<Readonly<ProductFeatureDefinition>> {
    const record = await db.productCapabilityDefinition.findUnique({ where: { key } });
    if (!record) throw new BadRequestException('Capability nao configurada: ' + key);
    return this.definition(record);
  }

  async requireActive(
    key: string,
    db: CapabilityDb = this.prisma,
  ): Promise<Readonly<ProductFeatureDefinition>> {
    const record = await db.productCapabilityDefinition.findUnique({ where: { key } });
    if (!record) throw new BadRequestException('Capability nao configurada: ' + key);
    if (record.status !== ProductCapabilityStatus.ACTIVE) {
      throw new ConflictException('Capability aposentada nao pode entrar em novo plano: ' + key);
    }
    return this.definition(record);
  }

  async listForResolution(
    db: CapabilityDb = this.prisma,
  ): Promise<readonly Readonly<ProductFeatureDefinition>[]> {
    const records = await db.productCapabilityDefinition.findMany({
      orderBy: { key: 'asc' },
    });
    return records.map((record) => this.definition(record));
  }

  async listGovernance() {
    return this.prisma.productCapabilityDefinition.findMany({
      orderBy: [{ status: 'asc' }, { domain: 'asc' }, { key: 'asc' }],
    });
  }

  async create(dto: CreateProductCapabilityDto, actorUserId?: string) {
    const definition = defineProductFeature({
      key: dto.key,
      kind: dto.kind,
      domain: dto.domain,
      description: dto.description.trim(),
      failClosedDefault: failClosedDefault(dto.kind),
      allowedPolicyValues: dto.allowedPolicyValues
        ? [...dto.allowedPolicyValues].sort()
        : undefined,
    });

    return this.serializable(async (tx) => {
      const existing = await tx.productCapabilityDefinition.findUnique({
        where: { key: definition.key },
      });
      if (existing) {
        const existingDefinition = this.definition(existing);
        const same =
          existing.status === ProductCapabilityStatus.ACTIVE &&
          existingDefinition.kind === definition.kind &&
          existingDefinition.domain === definition.domain &&
          existingDefinition.description === definition.description &&
          JSON.stringify(existingDefinition.allowedPolicyValues ?? []) ===
            JSON.stringify(definition.allowedPolicyValues ?? []);
        if (same) return existing;
        throw new ConflictException('Capability ja existe com definicao diferente');
      }

      const record = await tx.productCapabilityDefinition.create({
        data: {
          key: definition.key,
          kind: definition.kind as ProductEntitlementKind,
          domain: definition.domain,
          description: definition.description,
          allowedPolicyValues: definition.allowedPolicyValues
            ? [...definition.allowedPolicyValues]
            : Prisma.DbNull,
          status: ProductCapabilityStatus.ACTIVE,
        },
      });

      await this.audit.record(
        {
          gymId: null,
          userId: actorUserId ?? null,
          action: 'PRODUCT_CAPABILITY_CREATED',
          entity: 'ProductCapabilityDefinition',
          entityId: record.key,
          next: {
            key: record.key,
            kind: record.kind,
            domain: record.domain,
            description: record.description,
            allowedPolicyValues: record.allowedPolicyValues,
            status: record.status,
          },
        },
        tx,
      );
      return record;
    });
  }

  async retire(key: string, actorUserId?: string) {
    return this.serializable(async (tx) => {
      const current = await tx.productCapabilityDefinition.findUnique({
        where: { key },
      });
      if (!current) throw new NotFoundException('Capability nao encontrada');
      if (current.status === ProductCapabilityStatus.RETIRED) return current;

      const retired = await tx.productCapabilityDefinition.update({
        where: { key },
        data: { status: ProductCapabilityStatus.RETIRED },
      });
      await this.audit.record(
        {
          gymId: null,
          userId: actorUserId ?? null,
          action: 'PRODUCT_CAPABILITY_RETIRED',
          entity: 'ProductCapabilityDefinition',
          entityId: retired.key,
          previous: { status: current.status },
          next: { status: retired.status },
        },
        tx,
      );
      return retired;
    });
  }
}
