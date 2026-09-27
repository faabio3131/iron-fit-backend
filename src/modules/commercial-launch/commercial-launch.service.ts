import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CommercialFiscalMode,
  CommercialLaunchDecision,
  CommercialLaunchItemKind,
  CommercialLaunchMatrixStatus,
  Prisma,
  ProductEntitlementKind,
  ProductPlanVersionStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthSecurityService } from '../auth/auth-security.service';
import { ProductCapabilityCatalogService } from '../product-entitlements/product-capability-catalog.service';
import { MASTER_REQUIRED_LAUNCH_ITEMS } from './commercial-launch.constants';
import {
  AddCommercialLaunchOfferingDto,
  ApproveCommercialLaunchMatrixDto,
  CreateCommercialLaunchMatrixDto,
  SetCommercialLaunchPolicyDto,
  UpsertCommercialLaunchItemDto,
} from './dto/commercial-launch.dto';

const SERIALIZABLE_ATTEMPTS = 3;

type LaunchDb = PrismaService | Prisma.TransactionClient;

function dateValue(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

@Injectable()
export class CommercialLaunchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authSecurity: AuthSecurityService,
    private readonly capabilities: ProductCapabilityCatalogService,
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
    throw new ConflictException('Falha de concorrencia na Launch Matrix');
  }

  private async requireDraft(matrixId: string, db: LaunchDb = this.prisma) {
    const matrix = await db.commercialLaunchMatrix.findUnique({
      where: { id: matrixId },
    });
    if (!matrix) throw new NotFoundException('Launch Matrix nao encontrada');
    if (matrix.status !== CommercialLaunchMatrixStatus.DRAFT) {
      throw new ConflictException('Launch Matrix aprovada/retirada e imutavel');
    }
    return matrix;
  }

  async list() {
    const matrices = await this.prisma.commercialLaunchMatrix.findMany({
      orderBy: { version: 'desc' },
      include: {
        items: { orderBy: { itemKey: 'asc' } },
        offerings: { orderBy: { priceId: 'asc' } },
        policy: true,
      },
    });
    return matrices;
  }

  async create(dto: CreateCommercialLaunchMatrixDto, userId?: string) {
    const name = dto.name.trim();
    return this.serializable(async (tx) => {
      const existing = await tx.commercialLaunchMatrix.findUnique({
        where: { version: dto.version },
      });
      if (existing) {
        if (
          existing.status === CommercialLaunchMatrixStatus.DRAFT &&
          existing.name === name
        ) {
          return existing;
        }
        throw new ConflictException(
          'Versao da Launch Matrix ja existe com outra definicao/estado',
        );
      }

      const matrix = await tx.commercialLaunchMatrix.create({
        data: {
          version: dto.version,
          name,
          createdByUserId: userId ?? null,
        },
      });
      await this.audit.record(
        {
          userId: userId ?? null,
          action: 'COMMERCIAL_LAUNCH_MATRIX_CREATED',
          entity: 'CommercialLaunchMatrix',
          entityId: matrix.id,
          next: {
            version: matrix.version,
            name: matrix.name,
            status: matrix.status,
          },
        },
        tx,
      );
      return matrix;
    });
  }

  async upsertItem(
    matrixId: string,
    dto: UpsertCommercialLaunchItemDto,
    userId?: string,
  ) {
    if (
      dto.decision === CommercialLaunchDecision.EXTERNAL_BLOCKER &&
      (!dto.blockerOwner?.trim() || !dto.evidenceRequirement?.trim())
    ) {
      throw new BadRequestException(
        'EXTERNAL_BLOCKER exige blockerOwner e evidenceRequirement',
      );
    }
    if (
      (dto.decision === CommercialLaunchDecision.OUT ||
        dto.decision === CommercialLaunchDecision.EXTERNAL_BLOCKER) &&
      !dto.rationale?.trim()
    ) {
      throw new BadRequestException(
        'OUT/EXTERNAL_BLOCKER exige rationale',
      );
    }

    if (dto.featureKey) {
      await this.capabilities.requireActive(dto.featureKey);
    }

    return this.serializable(async (tx) => {
      await this.requireDraft(matrixId, tx);
      const previous = await tx.commercialLaunchItem.findUnique({
        where: {
          matrixId_itemKey: {
            matrixId,
            itemKey: dto.itemKey,
          },
        },
      });
      const data = {
        kind: dto.kind as CommercialLaunchItemKind,
        decision: dto.decision as CommercialLaunchDecision,
        featureKey: dto.featureKey ?? null,
        rationale: dto.rationale?.trim() || null,
        blockerOwner: dto.blockerOwner?.trim() || null,
        evidenceRequirement: dto.evidenceRequirement?.trim() || null,
      };
      const item = await tx.commercialLaunchItem.upsert({
        where: {
          matrixId_itemKey: {
            matrixId,
            itemKey: dto.itemKey,
          },
        },
        create: {
          matrixId,
          itemKey: dto.itemKey,
          ...data,
        },
        update: data,
      });
      await this.audit.record(
        {
          userId: userId ?? null,
          action: previous
            ? 'COMMERCIAL_LAUNCH_ITEM_UPDATED'
            : 'COMMERCIAL_LAUNCH_ITEM_CREATED',
          entity: 'CommercialLaunchItem',
          entityId: item.id,
          previous: previous
            ? {
                itemKey: previous.itemKey,
                kind: previous.kind,
                decision: previous.decision,
                featureKey: previous.featureKey,
              }
            : undefined,
          next: {
            itemKey: item.itemKey,
            kind: item.kind,
            decision: item.decision,
            featureKey: item.featureKey,
          },
        },
        tx,
      );
      return item;
    });
  }

  async removeItem(matrixId: string, itemKey: string, userId?: string) {
    return this.serializable(async (tx) => {
      await this.requireDraft(matrixId, tx);
      const previous = await tx.commercialLaunchItem.findUnique({
        where: { matrixId_itemKey: { matrixId, itemKey } },
      });
      if (!previous) return { removed: false, itemKey };

      await tx.commercialLaunchItem.delete({ where: { id: previous.id } });
      await this.audit.record(
        {
          userId: userId ?? null,
          action: 'COMMERCIAL_LAUNCH_ITEM_REMOVED',
          entity: 'CommercialLaunchItem',
          entityId: previous.id,
          previous: {
            itemKey: previous.itemKey,
            kind: previous.kind,
            decision: previous.decision,
            featureKey: previous.featureKey,
          },
          next: null,
        },
        tx,
      );
      return { removed: true, itemKey };
    });
  }

  private async requireActivePrice(
    priceId: string,
    db: LaunchDb = this.prisma,
    at = new Date(),
  ) {
    const price = await db.saasPlanPrice.findUnique({
      where: { id: priceId },
      include: {
        planVersion: {
          include: { productPlan: true },
        },
      },
    });
    if (
      !price ||
      !price.active ||
      price.effectiveFrom > at ||
      (price.effectiveUntil && price.effectiveUntil <= at)
    ) {
      throw new ConflictException('Preco SaaS nao esta ativo para o launch');
    }
    if (price.planVersion.status !== ProductPlanVersionStatus.PUBLISHED) {
      throw new ConflictException(
        'Offering de launch exige ProductPlanVersion PUBLISHED',
      );
    }
    return price;
  }

  async addOffering(
    matrixId: string,
    dto: AddCommercialLaunchOfferingDto,
    userId?: string,
  ) {
    return this.serializable(async (tx) => {
      await this.requireDraft(matrixId, tx);
      const price = await this.requireActivePrice(dto.priceId, tx);
      const existing = await tx.commercialLaunchOffering.findUnique({
        where: {
          matrixId_priceId: { matrixId, priceId: price.id },
        },
      });
      if (existing) return existing;

      const offering = await tx.commercialLaunchOffering.create({
        data: {
          matrixId,
          planVersionId: price.planVersionId,
          priceId: price.id,
        },
      });
      await this.audit.record(
        {
          userId: userId ?? null,
          action: 'COMMERCIAL_LAUNCH_OFFERING_ADDED',
          entity: 'CommercialLaunchOffering',
          entityId: offering.id,
          next: {
            priceId: price.id,
            priceCode: price.priceCode,
            planVersionId: price.planVersionId,
            planCode: price.planVersion.productPlan.code,
            planVersion: price.planVersion.version,
          },
        },
        tx,
      );
      return offering;
    });
  }

  async removeOffering(
    matrixId: string,
    priceId: string,
    userId?: string,
  ) {
    return this.serializable(async (tx) => {
      await this.requireDraft(matrixId, tx);
      const offering = await tx.commercialLaunchOffering.findUnique({
        where: { matrixId_priceId: { matrixId, priceId } },
      });
      if (!offering) return { removed: false, priceId };
      await tx.commercialLaunchOffering.delete({
        where: { id: offering.id },
      });
      await this.audit.record(
        {
          userId: userId ?? null,
          action: 'COMMERCIAL_LAUNCH_OFFERING_REMOVED',
          entity: 'CommercialLaunchOffering',
          entityId: offering.id,
          previous: {
            priceId: offering.priceId,
            planVersionId: offering.planVersionId,
          },
          next: null,
        },
        tx,
      );
      return { removed: true, priceId };
    });
  }

  async setPolicy(
    matrixId: string,
    dto: SetCommercialLaunchPolicyDto,
    userId?: string,
  ) {
    if (dto.trialEnabled) {
      if (!dto.trialPlanVersionId || !dto.trialDays) {
        throw new BadRequestException(
          'Trial habilitado exige trialPlanVersionId e trialDays',
        );
      }
    } else if (dto.trialPlanVersionId || dto.trialDays) {
      throw new BadRequestException(
        'Trial desabilitado nao aceita trialPlanVersionId/trialDays',
      );
    }

    if (dto.trialPlanVersionId) {
      const trialVersion = await this.prisma.productPlanVersion.findUnique({
        where: { id: dto.trialPlanVersionId },
      });
      if (
        !trialVersion ||
        trialVersion.status !== ProductPlanVersionStatus.PUBLISHED
      ) {
        throw new ConflictException(
          'Plano de trial exige versao PUBLISHED',
        );
      }
    }

    return this.serializable(async (tx) => {
      await this.requireDraft(matrixId, tx);
      const previous = await tx.commercialLaunchPolicy.findUnique({
        where: { matrixId },
      });
      const data = {
        trialEnabled: dto.trialEnabled,
        trialPlanVersionId: dto.trialEnabled
          ? dto.trialPlanVersionId!
          : null,
        trialDays: dto.trialEnabled ? dto.trialDays! : null,
        invoiceDueDays: dto.invoiceDueDays,
        dunningGraceDays: dto.dunningGraceDays,
        upgradePolicy: dto.upgradePolicy,
        downgradePolicy: dto.downgradePolicy,
        cancellationPolicy: dto.cancellationPolicy,
        refundPolicy: dto.refundPolicy,
        fiscalMode: dto.fiscalMode as CommercialFiscalMode,
      };
      const policy = await tx.commercialLaunchPolicy.upsert({
        where: { matrixId },
        create: { matrixId, ...data },
        update: data,
      });
      await this.audit.record(
        {
          userId: userId ?? null,
          action: previous
            ? 'COMMERCIAL_LAUNCH_POLICY_UPDATED'
            : 'COMMERCIAL_LAUNCH_POLICY_CREATED',
          entity: 'CommercialLaunchPolicy',
          entityId: policy.id,
          previous: previous
            ? {
                trialEnabled: previous.trialEnabled,
                trialPlanVersionId: previous.trialPlanVersionId,
                trialDays: previous.trialDays,
                invoiceDueDays: previous.invoiceDueDays,
                dunningGraceDays: previous.dunningGraceDays,
                upgradePolicy: previous.upgradePolicy,
                downgradePolicy: previous.downgradePolicy,
                cancellationPolicy: previous.cancellationPolicy,
                refundPolicy: previous.refundPolicy,
                fiscalMode: previous.fiscalMode,
              }
            : undefined,
          next: data,
        },
        tx,
      );
      return policy;
    });
  }

  private async expandedSnapshot(matrixId: string, db: LaunchDb = this.prisma) {
    const matrix = await db.commercialLaunchMatrix.findUnique({
      where: { id: matrixId },
      include: {
        items: { orderBy: { itemKey: 'asc' } },
        offerings: { orderBy: { priceId: 'asc' } },
        policy: true,
      },
    });
    if (!matrix) throw new NotFoundException('Launch Matrix nao encontrada');

    const priceIds = matrix.offerings.map((item) => item.priceId);
    const prices = priceIds.length
      ? await db.saasPlanPrice.findMany({
          where: { id: { in: priceIds } },
          include: {
            planVersion: {
              include: { productPlan: true },
            },
          },
          orderBy: { priceCode: 'asc' },
        })
      : [];
    const byPrice = new Map(prices.map((price) => [price.id, price]));

    return {
      matrix,
      prices,
      snapshot: {
        version: matrix.version,
        name: matrix.name,
        items: matrix.items.map((item) => ({
          itemKey: item.itemKey,
          kind: item.kind,
          decision: item.decision,
          featureKey: item.featureKey,
          rationale: item.rationale,
          blockerOwner: item.blockerOwner,
          evidenceRequirement: item.evidenceRequirement,
        })),
        offerings: matrix.offerings.map((offering) => {
          const price = byPrice.get(offering.priceId);
          if (!price) {
            throw new ConflictException(
              'Offering referencia preco inexistente',
            );
          }
          return {
            priceId: price.id,
            priceCode: price.priceCode,
            planVersionId: price.planVersionId,
            planCode: price.planVersion.productPlan.code,
            planVersion: price.planVersion.version,
            currency: price.currency,
            amountMinor: price.amountMinor,
            interval: price.interval,
            effectiveFrom: dateValue(price.effectiveFrom),
            effectiveUntil: dateValue(price.effectiveUntil),
          };
        }),
        policy: matrix.policy
          ? {
              trialEnabled: matrix.policy.trialEnabled,
              trialPlanVersionId: matrix.policy.trialPlanVersionId,
              trialDays: matrix.policy.trialDays,
              invoiceDueDays: matrix.policy.invoiceDueDays,
              dunningGraceDays: matrix.policy.dunningGraceDays,
              upgradePolicy: matrix.policy.upgradePolicy,
              downgradePolicy: matrix.policy.downgradePolicy,
              cancellationPolicy: matrix.policy.cancellationPolicy,
              refundPolicy: matrix.policy.refundPolicy,
              fiscalMode: matrix.policy.fiscalMode,
            }
          : null,
      },
    };
  }

  private hashSnapshot(snapshot: unknown) {
    return createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex');
  }

  private entitlementOpen(entitlement: any | null): boolean {
    if (!entitlement) return false;
    if (
      entitlement.kind === ProductEntitlementKind.FEATURE &&
      entitlement.featureEnabled === true
    ) {
      return true;
    }
    if (
      entitlement.kind === ProductEntitlementKind.LIMIT &&
      Number.isInteger(entitlement.limitValue) &&
      entitlement.limitValue > 0
    ) {
      return true;
    }
    return (
      entitlement.kind === ProductEntitlementKind.POLICY &&
      Array.isArray(entitlement.policyValues) &&
      entitlement.policyValues.length > 0
    );
  }

  private async validateApproval(matrixId: string, db: LaunchDb) {
    const expanded = await this.expandedSnapshot(matrixId, db);
    const { matrix, prices } = expanded;
    if (matrix.status !== CommercialLaunchMatrixStatus.DRAFT) {
      throw new ConflictException('Somente matriz DRAFT pode ser aprovada');
    }

    const items = new Map(
      matrix.items.map((item) => [item.itemKey, item]),
    );
    for (const required of MASTER_REQUIRED_LAUNCH_ITEMS) {
      const item = items.get(required.itemKey);
      if (!item) {
        throw new ConflictException(
          'Launch Matrix sem decisao obrigatoria: ' + required.itemKey,
        );
      }
      if (item.kind !== required.kind) {
        throw new ConflictException(
          'Launch item possui kind divergente: ' + required.itemKey,
        );
      }
      if (
        required.requiredDecision &&
        item.decision !== required.requiredDecision
      ) {
        throw new ConflictException(
          required.itemKey + ' deve ser LAUNCH',
        );
      }
      if (
        !required.requiredDecision &&
        item.decision === CommercialLaunchDecision.UNDECIDED
      ) {
        throw new ConflictException(
          'Decisao humana pendente: ' + required.itemKey,
        );
      }
    }

    if (matrix.items.some(
      (item) => item.decision === CommercialLaunchDecision.UNDECIDED,
    )) {
      throw new ConflictException(
        'Launch Matrix possui item UNDECIDED',
      );
    }

    if (!matrix.policy) {
      throw new ConflictException(
        'Politica comercial do launch nao configurada',
      );
    }
    if (
      matrix.policy.invoiceDueDays === null ||
      matrix.policy.dunningGraceDays === null ||
      !matrix.policy.upgradePolicy ||
      !matrix.policy.downgradePolicy ||
      !matrix.policy.cancellationPolicy ||
      !matrix.policy.refundPolicy ||
      matrix.policy.fiscalMode === CommercialFiscalMode.UNDECIDED
    ) {
      throw new ConflictException(
        'Politica comercial/fiscal do launch ainda incompleta',
      );
    }

    if (matrix.offerings.length === 0) {
      throw new ConflictException(
        'Launch exige ao menos um offering de plano/preco',
      );
    }

    const now = new Date();
    for (const offering of matrix.offerings) {
      const price = prices.find((candidate) => candidate.id === offering.priceId);
      if (
        !price ||
        !price.active ||
        price.effectiveFrom > now ||
        (price.effectiveUntil && price.effectiveUntil <= now) ||
        price.planVersionId !== offering.planVersionId ||
        price.planVersion.status !== ProductPlanVersionStatus.PUBLISHED
      ) {
        throw new ConflictException(
          'Offering nao esta comercialmente valido para aprovacao',
        );
      }
    }

    if (matrix.policy.trialEnabled) {
      if (
        !matrix.policy.trialPlanVersionId ||
        !matrix.policy.trialDays
      ) {
        throw new ConflictException('Trial habilitado esta incompleto');
      }
      const trialVersion = await db.productPlanVersion.findUnique({
        where: { id: matrix.policy.trialPlanVersionId },
      });
      if (
        !trialVersion ||
        trialVersion.status !== ProductPlanVersionStatus.PUBLISHED
      ) {
        throw new ConflictException(
          'Versao do plano de trial nao esta PUBLISHED',
        );
      }
    }

    const planVersionIds = [
      ...new Set(matrix.offerings.map((item) => item.planVersionId)),
    ];

    for (const item of matrix.items) {
      if (!item.featureKey) continue;

      const entitlements = await db.productPlanEntitlement.findMany({
        where: {
          planVersionId: { in: planVersionIds },
          featureKey: item.featureKey,
        },
      });
      const anyOpen = entitlements.some((value) =>
        this.entitlementOpen(value),
      );

      if (
        item.decision !== CommercialLaunchDecision.LAUNCH &&
        anyOpen
      ) {
        throw new ConflictException(
          item.itemKey +
            ' nao e LAUNCH, mas capability continua concedida em offering',
        );
      }
      if (
        item.decision === CommercialLaunchDecision.LAUNCH &&
        !anyOpen
      ) {
        throw new ConflictException(
          item.itemKey +
            ' e LAUNCH, mas nenhum offering concede a capability',
        );
      }
    }

    return expanded;
  }

  async approve(
    matrixId: string,
    userId: string,
    dto: ApproveCommercialLaunchMatrixDto,
  ) {
    await this.authSecurity.assertStepUp(
      userId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );

    return this.serializable(async (tx) => {
      const expanded = await this.validateApproval(matrixId, tx);
      const snapshotHash = this.hashSnapshot(expanded.snapshot);
      const approvedAt = new Date();

      await tx.commercialLaunchMatrix.updateMany({
        where: {
          status: CommercialLaunchMatrixStatus.APPROVED,
          id: { not: matrixId },
        },
        data: {
          status: CommercialLaunchMatrixStatus.RETIRED,
          retiredAt: approvedAt,
        },
      });

      const changed = await tx.commercialLaunchMatrix.updateMany({
        where: {
          id: matrixId,
          status: CommercialLaunchMatrixStatus.DRAFT,
          snapshotHash: null,
        },
        data: {
          status: CommercialLaunchMatrixStatus.APPROVED,
          snapshotHash,
          approvedByUserId: userId,
          approvedAt,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'Launch Matrix mudou durante aprovacao',
        );
      }

      const approved = await tx.commercialLaunchMatrix.findUniqueOrThrow({
        where: { id: matrixId },
        include: {
          items: { orderBy: { itemKey: 'asc' } },
          offerings: { orderBy: { priceId: 'asc' } },
          policy: true,
        },
      });

      await this.audit.record(
        {
          userId,
          action: 'COMMERCIAL_LAUNCH_MATRIX_APPROVED',
          entity: 'CommercialLaunchMatrix',
          entityId: matrixId,
          next: {
            version: approved.version,
            status: approved.status,
            snapshotHash,
            approvedAt,
            offeringCount: approved.offerings.length,
            itemCount: approved.items.length,
          },
        },
        tx,
      );

      return approved;
    });
  }

  async currentApproved() {
    const matrix = await this.prisma.commercialLaunchMatrix.findFirst({
      where: { status: CommercialLaunchMatrixStatus.APPROVED },
    });
    if (!matrix) {
      throw new ServiceUnavailableException(
        'Launch Matrix APPROVED nao configurada',
      );
    }
    const expanded = await this.expandedSnapshot(matrix.id);
    const recomputed = this.hashSnapshot(expanded.snapshot);
    if (!matrix.snapshotHash || matrix.snapshotHash !== recomputed) {
      throw new ServiceUnavailableException(
        'Launch Matrix APPROVED divergiu do snapshot congelado',
      );
    }
    return {
      ...expanded.snapshot,
      id: matrix.id,
      status: matrix.status,
      snapshotHash: matrix.snapshotHash,
      approvedAt: matrix.approvedAt,
      approvedByUserId: matrix.approvedByUserId,
      integrity: 'PASS' as const,
    };
  }
}
