import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreatorCommercialRuleStatus,
  CreatorCompensationMode,
  CreatorRightsConsentStatus,
  CreatorRightsGrantStatus,
  CreatorRightsHolderStatus,
  CreatorRightsScope,
  CreatorSettlementStatus,
  CreatorUsageDeliveryKind,
  CreatorUsageEventType,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AccrueUsageEventDto,
  CommercialRuleReasonDto,
  CreateCommercialRuleVersionDto,
  CreateCreatorSettlementDto,
  MarkCreatorSettlementSettledDto,
  RegisterCommercialAgreementDto,
} from './dto/creator-commercial.dto';

const SERIALIZABLE_ATTEMPTS = 3;
const MAX_MINOR_AMOUNT = 2147483647;

export type CreatorCommercialContext = {
  scope: CreatorRightsScope;
  gymId: string | null;
};

@Injectable()
export class CreatorCommercialService {
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
    throw new ConflictException('Falha de concorrencia no dominio comercial CN8');
  }

  private fingerprint(payload: unknown) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private async assertContext(
    tx: Prisma.TransactionClient,
    context: CreatorCommercialContext,
  ) {
    if (context.scope === CreatorRightsScope.GLOBAL) {
      if (context.gymId !== null) {
        throw new BadRequestException('Commercial GLOBAL nao aceita gymId');
      }
      return;
    }
    if (!context.gymId) {
      throw new ForbiddenException('Commercial TENANT exige tenant autenticado');
    }
    const gym = await tx.gym.findFirst({
      where: { id: context.gymId, active: true },
      select: { id: true },
    });
    if (!gym) throw new ForbiddenException('Tenant ativo nao encontrado');
  }

  private normalizeCurrency(currency: string) {
    const normalized = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      throw new BadRequestException('currency deve usar codigo ISO de 3 letras');
    }
    return normalized;
  }

  private async scopedAgreement(
    tx: Prisma.TransactionClient,
    context: CreatorCommercialContext,
    agreementId: string,
  ) {
    const agreement = await tx.creatorCommercialAgreement.findFirst({
      where: {
        id: agreementId,
        scope: context.scope,
        gymId: context.gymId,
      },
    });
    if (!agreement) {
      throw new NotFoundException('Commercial agreement nao encontrado no escopo');
    }
    return agreement;
  }

  async registerAgreement(
    context: CreatorCommercialContext,
    dto: RegisterCommercialAgreementDto,
    actorUserId?: string,
  ) {
    const currency = this.normalizeCurrency(dto.currency);
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const content = await tx.creatorContent.findFirst({
        where: {
          id: dto.contentId,
          scope: context.scope,
          gymId: context.gymId,
        },
        include: {
          rightsGrant: {
            include: {
              versions: {
                where: { status: CreatorRightsGrantStatus.ACTIVE },
                take: 1,
                orderBy: { version: 'desc' },
                include: { rightsHolder: true, consents: true },
              },
            },
          },
        },
      });
      if (!content) {
        throw new NotFoundException('CreatorContent nao encontrado no escopo comercial');
      }
      const activeRights = content.rightsGrant.versions[0];
      if (!activeRights) {
        throw new ConflictException('Commercial agreement exige Rights Grant ACTIVE');
      }
      const now = new Date();
      if (activeRights.rightsHolder.status !== CreatorRightsHolderStatus.ACTIVE) {
        throw new ConflictException('Beneficiario de rights nao esta ACTIVE');
      }
      if (
        activeRights.validFrom > now ||
        (activeRights.validUntil && activeRights.validUntil <= now)
      ) {
        throw new ConflictException('Rights Grant fora da janela comercial vigente');
      }
      if (activeRights.requiresCreatorConsent) {
        const consent = activeRights.consents.some(
          (item) =>
            item.status === CreatorRightsConsentStatus.ACTIVE &&
            item.validFrom <= now &&
            (!item.validUntil || item.validUntil > now),
        );
        if (!consent) {
          throw new ConflictException(
            'Commercial agreement exige consentimento vigente quando Rights exige consent',
          );
        }
      }
      if (activeRights.rightsHolderId !== dto.beneficiaryRightsHolderId) {
        throw new ConflictException(
          'Beneficiario comercial deve ser o Rights Holder ACTIVE do conteudo',
        );
      }

      const fingerprint = this.fingerprint({
        scope: context.scope,
        gymId: context.gymId,
        contentId: content.id,
        beneficiaryRightsHolderId: activeRights.rightsHolderId,
        currency,
      });
      const existing = await tx.creatorCommercialAgreement.findUnique({
        where: { fingerprint },
      });
      if (existing) return existing;

      const agreement = await tx.creatorCommercialAgreement.create({
        data: {
          scope: context.scope,
          gymId: context.gymId,
          contentId: content.id,
          beneficiaryRightsHolderId: activeRights.rightsHolderId,
          beneficiaryLegalName: activeRights.rightsHolder.legalName.trim(),
          currency,
          fingerprint,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CREATOR_COMMERCIAL_AGREEMENT_REGISTERED',
          entity: 'CreatorCommercialAgreement',
          entityId: agreement.id,
          next: {
            scope: agreement.scope,
            contentId: agreement.contentId,
            beneficiaryRightsHolderId: agreement.beneficiaryRightsHolderId,
            currency: agreement.currency,
          },
        },
        tx,
      );
      return agreement;
    });
  }

  private normalizeRule(dto: CreateCommercialRuleVersionDto) {
    const compensationMode = dto.compensationMode as CreatorCompensationMode;
    const qualifyingEventType = dto.qualifyingEventType as CreatorUsageEventType;
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveUntil = dto.effectiveUntil
      ? new Date(dto.effectiveUntil)
      : null;
    if (effectiveUntil && effectiveUntil <= effectiveFrom) {
      throw new BadRequestException('effectiveUntil deve ser posterior a effectiveFrom');
    }
    if (compensationMode === CreatorCompensationMode.FIXED_PER_EVENT) {
      if (!dto.fixedAmountMinor || dto.revenueShareBps !== undefined) {
        throw new BadRequestException(
          'FIXED_PER_EVENT exige fixedAmountMinor e nao aceita revenueShareBps',
        );
      }
      return {
        compensationMode,
        qualifyingEventType,
        fixedAmountMinor: dto.fixedAmountMinor,
        revenueShareBps: null,
        effectiveFrom,
        effectiveUntil,
        termsReference: dto.termsReference.trim(),
        termsSha256: dto.termsSha256.toLowerCase(),
      };
    }
    if (dto.fixedAmountMinor !== undefined || !dto.revenueShareBps) {
      throw new BadRequestException(
        'REVENUE_SHARE_BPS exige revenueShareBps e nao aceita fixedAmountMinor',
      );
    }
    return {
      compensationMode,
      qualifyingEventType,
      fixedAmountMinor: null,
      revenueShareBps: dto.revenueShareBps,
      effectiveFrom,
      effectiveUntil,
      termsReference: dto.termsReference.trim(),
      termsSha256: dto.termsSha256.toLowerCase(),
    };
  }

  async createRuleVersion(
    context: CreatorCommercialContext,
    agreementId: string,
    dto: CreateCommercialRuleVersionDto,
    actorUserId?: string,
  ) {
    const normalized = this.normalizeRule(dto);
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const agreement = await this.scopedAgreement(tx, context, agreementId);
      const draft = await tx.creatorCommercialRuleVersion.findFirst({
        where: { agreementId, status: CreatorCommercialRuleStatus.DRAFT },
        orderBy: { version: 'desc' },
      });
      if (draft) {
        const exact =
          draft.compensationMode === normalized.compensationMode &&
          draft.qualifyingEventType === normalized.qualifyingEventType &&
          draft.fixedAmountMinor === normalized.fixedAmountMinor &&
          draft.revenueShareBps === normalized.revenueShareBps &&
          draft.effectiveFrom.getTime() === normalized.effectiveFrom.getTime() &&
          (draft.effectiveUntil?.getTime() ?? null) ===
            (normalized.effectiveUntil?.getTime() ?? null) &&
          draft.termsReference === normalized.termsReference &&
          draft.termsSha256 === normalized.termsSha256;
        if (exact) return draft;
        throw new ConflictException(
          'Agreement ja possui DRAFT diferente; nova alteracao exige resolver o DRAFT atual',
        );
      }
      const latest = await tx.creatorCommercialRuleVersion.findFirst({
        where: { agreementId },
        orderBy: { version: 'desc' },
      });
      const version = (latest?.version ?? 0) + 1;
      const fingerprint = this.fingerprint({
        agreementId: agreement.id,
        version,
        ...normalized,
        effectiveFrom: normalized.effectiveFrom.toISOString(),
        effectiveUntil: normalized.effectiveUntil?.toISOString() ?? null,
      });
      const rule = await tx.creatorCommercialRuleVersion.create({
        data: {
          agreementId: agreement.id,
          version,
          status: CreatorCommercialRuleStatus.DRAFT,
          compensationMode: normalized.compensationMode,
          qualifyingEventType: normalized.qualifyingEventType,
          fixedAmountMinor: normalized.fixedAmountMinor,
          revenueShareBps: normalized.revenueShareBps,
          effectiveFrom: normalized.effectiveFrom,
          effectiveUntil: normalized.effectiveUntil,
          termsReference: normalized.termsReference,
          termsSha256: normalized.termsSha256,
          fingerprint,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CREATOR_COMMERCIAL_RULE_VERSION_CREATED',
          entity: 'CreatorCommercialRuleVersion',
          entityId: rule.id,
          next: {
            agreementId: agreement.id,
            version: rule.version,
            compensationMode: rule.compensationMode,
            qualifyingEventType: rule.qualifyingEventType,
          },
        },
        tx,
      );
      return rule;
    });
  }

  async activateRuleVersion(
    context: CreatorCommercialContext,
    agreementId: string,
    ruleVersionId: string,
    actorUserId?: string,
  ) {
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      await this.scopedAgreement(tx, context, agreementId);
      const target = await tx.creatorCommercialRuleVersion.findFirst({
        where: { id: ruleVersionId, agreementId },
      });
      if (!target) throw new NotFoundException('Rule version nao encontrada');
      if (target.status === CreatorCommercialRuleStatus.ACTIVE) return target;
      if (target.status !== CreatorCommercialRuleStatus.DRAFT) {
        throw new ConflictException('Somente DRAFT pode ser ativado');
      }
      const now = new Date();
      if (target.effectiveFrom > now) {
        throw new ConflictException(
          'Rule futura deve permanecer DRAFT ate effectiveFrom',
        );
      }
      if (target.effectiveUntil && target.effectiveUntil <= now) {
        throw new ConflictException('Rule ja expirou e nao pode ser ativada');
      }

      const active = await tx.creatorCommercialRuleVersion.findFirst({
        where: {
          agreementId,
          status: CreatorCommercialRuleStatus.ACTIVE,
        },
      });
      if (active) {
        await tx.creatorCommercialRuleVersion.update({
          where: { id: active.id },
          data: {
            status: CreatorCommercialRuleStatus.SUPERSEDED,
            supersededAt: now,
          },
        });
      }
      const activated = await tx.creatorCommercialRuleVersion.update({
        where: { id: target.id },
        data: {
          status: CreatorCommercialRuleStatus.ACTIVE,
          activatedAt: now,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CREATOR_COMMERCIAL_RULE_ACTIVATED',
          entity: 'CreatorCommercialRuleVersion',
          entityId: activated.id,
          previous: { supersededRuleVersionId: active?.id ?? null },
          next: { agreementId, version: activated.version, status: activated.status },
        },
        tx,
      );
      return activated;
    });
  }

  async revokeRuleVersion(
    context: CreatorCommercialContext,
    agreementId: string,
    ruleVersionId: string,
    dto: CommercialRuleReasonDto,
    actorUserId?: string,
  ) {
    const reason = dto.reason.trim();
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      await this.scopedAgreement(tx, context, agreementId);
      const target = await tx.creatorCommercialRuleVersion.findFirst({
        where: { id: ruleVersionId, agreementId },
      });
      if (!target) throw new NotFoundException('Rule version nao encontrada');
      if (target.status === CreatorCommercialRuleStatus.REVOKED) {
        if (target.revocationReason === reason) return target;
        throw new ConflictException('Rule ja REVOKED com motivo diferente');
      }
      if (target.status === CreatorCommercialRuleStatus.SUPERSEDED) {
        throw new ConflictException('Rule SUPERSEDED e historica/imutavel');
      }
      const revoked = await tx.creatorCommercialRuleVersion.update({
        where: { id: target.id },
        data: {
          status: CreatorCommercialRuleStatus.REVOKED,
          revokedAt: new Date(),
          revocationReason: reason,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CREATOR_COMMERCIAL_RULE_REVOKED',
          entity: 'CreatorCommercialRuleVersion',
          entityId: revoked.id,
          previous: { status: target.status },
          next: { status: revoked.status, reason },
        },
        tx,
      );
      return revoked;
    });
  }

  private ruleAppliesAt(rule: any, observedAt: Date) {
    if (!rule.activatedAt) return false;
    if (observedAt < rule.effectiveFrom || observedAt < rule.activatedAt) {
      return false;
    }
    if (rule.effectiveUntil && observedAt >= rule.effectiveUntil) return false;
    if (rule.supersededAt && observedAt >= rule.supersededAt) return false;
    if (rule.revokedAt && observedAt >= rule.revokedAt) return false;
    return true;
  }

  private calculation(rule: any, dto: AccrueUsageEventDto) {
    if (rule.compensationMode === CreatorCompensationMode.FIXED_PER_EVENT) {
      if (
        dto.eligibleRevenueMinor !== undefined ||
        dto.revenueSourceType !== undefined ||
        dto.revenueSourceId !== undefined ||
        dto.revenueEvidenceSha256 !== undefined
      ) {
        throw new BadRequestException(
          'FIXED_PER_EVENT nao aceita base de receita externa',
        );
      }
      if (!rule.fixedAmountMinor || rule.fixedAmountMinor <= 0) {
        throw new ConflictException('Rule FIXED persistida possui forma invalida');
      }
      return {
        fixedAmountMinor: rule.fixedAmountMinor as number,
        eligibleRevenueMinor: null,
        revenueShareBps: null,
        revenueSourceType: null,
        revenueSourceId: null,
        revenueEvidenceSha256: null,
        amountMinor: rule.fixedAmountMinor as number,
      };
    }

    if (
      dto.eligibleRevenueMinor === undefined ||
      !dto.revenueSourceType?.trim() ||
      !dto.revenueSourceId?.trim() ||
      !dto.revenueEvidenceSha256
    ) {
      throw new BadRequestException(
        'REVENUE_SHARE_BPS exige receita elegivel e proveniencia completa',
      );
    }
    if (!rule.revenueShareBps || rule.revenueShareBps < 1) {
      throw new ConflictException('Rule REVENUE_SHARE persistida possui forma invalida');
    }
    const amountMinor = Math.floor(
      (dto.eligibleRevenueMinor * rule.revenueShareBps) / 10000,
    );
    if (amountMinor > MAX_MINOR_AMOUNT) {
      throw new BadRequestException('Accrual excede limite monetario suportado');
    }
    return {
      fixedAmountMinor: null,
      eligibleRevenueMinor: dto.eligibleRevenueMinor,
      revenueShareBps: rule.revenueShareBps as number,
      revenueSourceType: dto.revenueSourceType.trim().toLowerCase(),
      revenueSourceId: dto.revenueSourceId.trim(),
      revenueEvidenceSha256: dto.revenueEvidenceSha256.toLowerCase(),
      amountMinor,
    };
  }

  async accrueUsageEvent(
    context: CreatorCommercialContext,
    usageEventId: string,
    dto: AccrueUsageEventDto,
    actorUserId?: string,
  ) {
    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const agreement = await this.scopedAgreement(tx, context, dto.agreementId);
      const event = await tx.creatorContentUsageEvent.findUnique({
        where: { id: usageEventId },
        include: {
          usageSession: {
            include: { attributionSnapshot: true },
          },
        },
      });
      if (!event) throw new NotFoundException('CN7 usage event nao encontrado');
      const session = event.usageSession;
      const attribution = session.attributionSnapshot;
      if (
        session.deliveryKind !== CreatorUsageDeliveryKind.MANAGED_CONTENT ||
        !session.contentId ||
        !session.contentVersionId ||
        !attribution
      ) {
        throw new ConflictException(
          'Somente MANAGED_CONTENT com attribution snapshot pode gerar accrual CN8',
        );
      }
      if (
        context.scope === CreatorRightsScope.TENANT &&
        session.gymId !== context.gymId
      ) {
        throw new ForbiddenException('Usage event pertence a outro tenant');
      }
      if (session.contentId !== agreement.contentId) {
        throw new ConflictException('Usage event nao pertence ao conteudo do agreement');
      }
      if (
        attribution.contentId !== session.contentId ||
        attribution.contentVersionId !== session.contentVersionId
      ) {
        throw new ConflictException('Attribution snapshot divergiu da usage session');
      }
      if (
        attribution.rightsHolderId !== agreement.beneficiaryRightsHolderId
      ) {
        throw new ConflictException(
          'Attribution Rights Holder diverge do beneficiario comercial',
        );
      }

      const rules = await tx.creatorCommercialRuleVersion.findMany({
        where: {
          agreementId: agreement.id,
          qualifyingEventType: event.eventType,
          status: {
            in: [
              CreatorCommercialRuleStatus.ACTIVE,
              CreatorCommercialRuleStatus.SUPERSEDED,
              CreatorCommercialRuleStatus.REVOKED,
            ],
          },
        },
        orderBy: { version: 'desc' },
      });
      const rule = rules.find((item) =>
        this.ruleAppliesAt(item, event.observedAt),
      );
      if (!rule) {
        throw new ConflictException(
          'Nenhuma rule comercial ativa e historicamente aplicavel ao evento CN7',
        );
      }

      const calculation = this.calculation(rule, dto);
      const fingerprint = this.fingerprint({
        agreementId: agreement.id,
        ruleVersionId: rule.id,
        usageSessionId: session.id,
        usageEventId: event.id,
        attributionSnapshotId: attribution.id,
        contentId: session.contentId,
        contentVersionId: session.contentVersionId,
        beneficiaryRightsHolderId: agreement.beneficiaryRightsHolderId,
        compensationMode: rule.compensationMode,
        qualifyingEventType: event.eventType,
        currency: agreement.currency,
        ...calculation,
      });
      const existing = await tx.creatorCommercialAccrual.findUnique({
        where: {
          ruleVersionId_usageEventId: {
            ruleVersionId: rule.id,
            usageEventId: event.id,
          },
        },
      });
      if (existing) {
        if (existing.fingerprint === fingerprint) {
          return { accrual: existing, idempotent: true };
        }
        throw new ConflictException(
          'Evento CN7 ja possui accrual divergente para esta rule',
        );
      }

      const accrual = await tx.creatorCommercialAccrual.create({
        data: {
          scope: context.scope,
          gymId: context.gymId,
          consumptionGymId: session.gymId,
          agreementId: agreement.id,
          ruleVersionId: rule.id,
          usageSessionId: session.id,
          usageEventId: event.id,
          usageObservationSource: event.observationSource,
          attributionSnapshotId: attribution.id,
          contentId: session.contentId,
          contentVersionId: session.contentVersionId,
          beneficiaryRightsHolderId: agreement.beneficiaryRightsHolderId,
          beneficiaryLegalName: agreement.beneficiaryLegalName,
          compensationMode: rule.compensationMode,
          qualifyingEventType: event.eventType,
          currency: agreement.currency,
          fixedAmountMinor: calculation.fixedAmountMinor,
          eligibleRevenueMinor: calculation.eligibleRevenueMinor,
          revenueShareBps: calculation.revenueShareBps,
          revenueSourceType: calculation.revenueSourceType,
          revenueSourceId: calculation.revenueSourceId,
          revenueEvidenceSha256: calculation.revenueEvidenceSha256,
          amountMinor: calculation.amountMinor,
          sourceEventObservedAt: event.observedAt,
          fingerprint,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CREATOR_COMMERCIAL_ACCRUAL_RECORDED',
          entity: 'CreatorCommercialAccrual',
          entityId: accrual.id,
          next: {
            agreementId: agreement.id,
            ruleVersionId: rule.id,
            usageEventId: event.id,
            observationSource: event.observationSource,
            amountMinor: accrual.amountMinor,
            currency: accrual.currency,
          },
        },
        tx,
      );
      return { accrual, idempotent: false };
    });
  }

  async createSettlement(
    context: CreatorCommercialContext,
    dto: CreateCreatorSettlementDto,
    actorUserId?: string,
  ) {
    const currency = this.normalizeCurrency(dto.currency);
    const settlementKey = dto.settlementKey.trim().toLowerCase();
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd <= periodStart) {
      throw new BadRequestException('periodEnd deve ser posterior a periodStart');
    }

    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const replay = await tx.creatorSettlementBatch.findFirst({
        where: {
          scope: context.scope,
          gymId: context.gymId,
          settlementKey,
        },
        include: { items: true },
      });
      if (replay) {
        const exact =
          replay.beneficiaryRightsHolderId === dto.beneficiaryRightsHolderId &&
          replay.currency === currency &&
          replay.periodStart.getTime() === periodStart.getTime() &&
          replay.periodEnd.getTime() === periodEnd.getTime();
        if (exact) return { settlement: replay, idempotent: true };
        throw new ConflictException(
          'settlementKey ja utilizado com parametros divergentes',
        );
      }

      const beneficiary = await tx.creatorRightsHolder.findFirst({
        where: {
          id: dto.beneficiaryRightsHolderId,
          scope: context.scope,
          gymId: context.gymId,
        },
      });
      if (!beneficiary) {
        throw new NotFoundException('Beneficiario nao encontrado no escopo comercial');
      }

      const candidates = await tx.creatorCommercialAccrual.findMany({
        where: {
          scope: context.scope,
          gymId: context.gymId,
          beneficiaryRightsHolderId: beneficiary.id,
          currency,
          sourceEventObservedAt: { gte: periodStart, lt: periodEnd },
          amountMinor: { gt: 0 },
        },
        include: { settlementItem: true },
        orderBy: [{ sourceEventObservedAt: 'asc' }, { id: 'asc' }],
      });
      const accruals = candidates.filter((item) => !item.settlementItem);
      if (accruals.length === 0) {
        throw new ConflictException(
          'Nenhum accrual positivo e ainda nao liquidado no periodo',
        );
      }
      const totalAmountMinor = accruals.reduce(
        (total, item) => total + item.amountMinor,
        0,
      );
      if (totalAmountMinor > MAX_MINOR_AMOUNT) {
        throw new ConflictException(
          'Settlement excede limite monetario; divida o periodo em lotes menores',
        );
      }
      const fingerprint = this.fingerprint({
        scope: context.scope,
        gymId: context.gymId,
        settlementKey,
        beneficiaryRightsHolderId: beneficiary.id,
        currency,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        accruals: accruals.map((item) => [item.id, item.amountMinor]),
      });
      const settlement = await tx.creatorSettlementBatch.create({
        data: {
          scope: context.scope,
          gymId: context.gymId,
          beneficiaryRightsHolderId: beneficiary.id,
          beneficiaryLegalName: beneficiary.legalName.trim(),
          currency,
          settlementKey,
          periodStart,
          periodEnd,
          status: CreatorSettlementStatus.FINALIZED,
          accrualCount: accruals.length,
          totalAmountMinor,
          fingerprint,
        },
      });
      await tx.creatorSettlementItem.createMany({
        data: accruals.map((item) => ({
          settlementBatchId: settlement.id,
          accrualId: item.id,
          amountMinor: item.amountMinor,
          fingerprint: this.fingerprint({
            settlementKey,
            settlementBatchId: settlement.id,
            accrualId: item.id,
            amountMinor: item.amountMinor,
          }),
        })),
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CREATOR_SETTLEMENT_FINALIZED',
          entity: 'CreatorSettlementBatch',
          entityId: settlement.id,
          next: {
            beneficiaryRightsHolderId: beneficiary.id,
            currency,
            accrualCount: accruals.length,
            totalAmountMinor,
            periodStart,
            periodEnd,
          },
        },
        tx,
      );
      const withItems = await tx.creatorSettlementBatch.findUnique({
        where: { id: settlement.id },
        include: { items: true },
      });
      return { settlement: withItems, idempotent: false };
    });
  }

  async markSettlementSettled(
    context: CreatorCommercialContext,
    settlementId: string,
    dto: MarkCreatorSettlementSettledDto,
    actorUserId?: string,
  ) {
    const settlementProvider = dto.settlementProvider.trim().toLowerCase();
    const externalSettlementId = dto.externalSettlementId.trim();
    const settlementEvidenceSha256 = dto.settlementEvidenceSha256.toLowerCase();
    const settledAt = dto.settledAt ? new Date(dto.settledAt) : new Date();
    if (settledAt > new Date()) {
      throw new BadRequestException('settledAt nao pode estar no futuro');
    }

    return this.serializable(async (tx) => {
      await this.assertContext(tx, context);
      const settlement = await tx.creatorSettlementBatch.findFirst({
        where: {
          id: settlementId,
          scope: context.scope,
          gymId: context.gymId,
        },
      });
      if (!settlement) {
        throw new NotFoundException('Creator settlement nao encontrado no escopo');
      }
      if (settlement.status === CreatorSettlementStatus.SETTLED) {
        const exact =
          settlement.settlementProvider === settlementProvider &&
          settlement.externalSettlementId === externalSettlementId &&
          settlement.settlementEvidenceSha256 === settlementEvidenceSha256;
        if (exact) return { settlement, idempotent: true };
        throw new ConflictException('Settlement ja SETTLED com evidencia diferente');
      }

      const reusedExternalReference = await tx.creatorSettlementBatch.findFirst({
        where: {
          status: CreatorSettlementStatus.SETTLED,
          settlementProvider,
          externalSettlementId,
          id: { not: settlement.id },
        },
      });
      if (reusedExternalReference) {
        throw new ConflictException(
          'Referencia externa de settlement ja utilizada por outro lote',
        );
      }

      const settled = await tx.creatorSettlementBatch.update({
        where: { id: settlement.id },
        data: {
          status: CreatorSettlementStatus.SETTLED,
          settledAt,
          settlementProvider,
          externalSettlementId,
          settlementEvidenceSha256,
        },
      });
      await this.audit.record(
        {
          gymId: context.gymId,
          userId: actorUserId ?? null,
          action: 'CREATOR_SETTLEMENT_SETTLED_ATTESTED',
          entity: 'CreatorSettlementBatch',
          entityId: settled.id,
          previous: { status: settlement.status },
          next: {
            status: settled.status,
            settlementProvider,
            externalSettlementId,
            settledAt,
            paymentExecutionByIron: false,
          },
        },
        tx,
      );
      return { settlement: settled, idempotent: false };
    });
  }
}
