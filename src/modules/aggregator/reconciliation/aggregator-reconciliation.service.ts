import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AggregatorReconciliationStatus,
  AggregatorRiskStatus,
  AggregatorSettlementStatus,
  AggregatorVisitStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';

const MAX_SERIALIZABLE_RETRIES = 3;
const RECONCILIATION_VERSION = 'AGG7_V1';
const AGG7_RISK_TYPES = [
  'MISSING_PROVIDER_CHECKIN',
  'MISSING_PHYSICAL_ENTRY',
  'UNPAID_RISK',
  'AMOUNT_DIVERGENCE',
  'DUPLICATE',
  'MANUAL_REVIEW',
  'ORPHAN_SETTLEMENT',
] as const;

interface SettlementFact {
  id?: string;
  status: AggregatorSettlementStatus;
  amountExpected: number | null;
  amountConfirmed: number | null;
  currency: string | null;
}

export interface ThreeWayReconciliationFacts {
  authorizationStatus: AggregatorVisitStatus;
  physicalLinked: boolean;
  physicalAllowed: boolean;
  settlementCount: number;
  settlement: SettlementFact | null;
}

export function classifyThreeWayReconciliation(
  facts: ThreeWayReconciliationFacts,
): AggregatorReconciliationStatus {
  if (facts.settlementCount > 1) {
    return AggregatorReconciliationStatus.DUPLICATE;
  }

  const settlement = facts.settlement;
  const authorizationConfirmed =
    facts.authorizationStatus === AggregatorVisitStatus.CONFIRMED;
  const authorizationProvisional =
    facts.authorizationStatus === AggregatorVisitStatus.PROVISIONAL;
  const providerConfirmed =
    settlement?.status === AggregatorSettlementStatus.CONFIRMED ||
    settlement?.status === AggregatorSettlementStatus.RECEIVED;

  if (
    facts.physicalLinked &&
    (!facts.physicalAllowed ||
      (!authorizationConfirmed && !authorizationProvisional))
  ) {
    return AggregatorReconciliationStatus.MANUAL_REVIEW;
  }

  if (
    providerConfirmed &&
    !authorizationConfirmed &&
    !authorizationProvisional
  ) {
    return AggregatorReconciliationStatus.MANUAL_REVIEW;
  }

  if (settlement?.status === AggregatorSettlementStatus.DISPUTED) {
    return AggregatorReconciliationStatus.MANUAL_REVIEW;
  }

  if (
    settlement?.status === AggregatorSettlementStatus.DIVERGENT ||
    (settlement?.amountExpected !== null &&
      settlement?.amountExpected !== undefined &&
      settlement?.amountConfirmed !== null &&
      settlement?.amountConfirmed !== undefined &&
      settlement.amountExpected !== settlement.amountConfirmed)
  ) {
    return AggregatorReconciliationStatus.AMOUNT_DIVERGENCE;
  }

  if (settlement?.status === AggregatorSettlementStatus.EXPIRED) {
    return authorizationConfirmed || facts.physicalLinked
      ? AggregatorReconciliationStatus.UNPAID_RISK
      : AggregatorReconciliationStatus.MANUAL_REVIEW;
  }

  if (
    settlement &&
    ((settlement.status === AggregatorSettlementStatus.RECEIVED &&
      settlement.amountConfirmed === null) ||
      ((settlement.amountExpected !== null ||
        settlement.amountConfirmed !== null) &&
        !settlement.currency))
  ) {
    return AggregatorReconciliationStatus.MANUAL_REVIEW;
  }

  if (providerConfirmed && !facts.physicalLinked) {
    return AggregatorReconciliationStatus.MISSING_PHYSICAL_ENTRY;
  }

  if (authorizationConfirmed && facts.physicalLinked) {
    if (!settlement) {
      return AggregatorReconciliationStatus.MISSING_PROVIDER_CHECKIN;
    }
    if (settlement.status === AggregatorSettlementStatus.RECEIVED) {
      return AggregatorReconciliationStatus.RECONCILED;
    }
    return AggregatorReconciliationStatus.PENDING;
  }

  return AggregatorReconciliationStatus.PENDING;
}

function potentialAmount(
  status: AggregatorReconciliationStatus,
  settlement: SettlementFact | null,
) {
  if (!settlement) {
    return null;
  }
  if (
    status === AggregatorReconciliationStatus.AMOUNT_DIVERGENCE &&
    settlement.amountExpected !== null &&
    settlement.amountConfirmed !== null
  ) {
    return Math.abs(settlement.amountExpected - settlement.amountConfirmed);
  }
  return settlement.amountExpected ?? settlement.amountConfirmed ?? null;
}

function riskTypeFor(status: AggregatorReconciliationStatus) {
  switch (status) {
    case AggregatorReconciliationStatus.MISSING_PROVIDER_CHECKIN:
    case AggregatorReconciliationStatus.MISSING_PHYSICAL_ENTRY:
    case AggregatorReconciliationStatus.UNPAID_RISK:
    case AggregatorReconciliationStatus.AMOUNT_DIVERGENCE:
    case AggregatorReconciliationStatus.DUPLICATE:
    case AggregatorReconciliationStatus.MANUAL_REVIEW:
      return status;
    default:
      return null;
  }
}

@Injectable()
export class AggregatorReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private requireGym(gymId?: string) {
    if (!gymId) {
      throw new BadRequestException('Tenant ativo obrigatorio');
    }
    return gymId;
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable || attempt === MAX_SERIALIZABLE_RETRIES) {
          throw error;
        }
      }
    }

    throw new ConflictException('Falha de concorrencia na reconciliacao');
  }

  async linkPhysicalEntry(
    visitAuthorizationId: string,
    accessEventId: string,
    gymId?: string,
    actorUserId?: string,
  ) {
    const tenantId = this.requireGym(gymId);

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const visit = await tx.aggregatorVisitAuthorization.findFirst({
            where: {
              id: visitAuthorizationId,
              member: { connection: { gymId: tenantId } },
            },
            select: {
              id: true,
              status: true,
              member: { select: { studentId: true } },
            },
          });
          if (!visit) {
            throw new NotFoundException('Autorizacao de visita nao encontrada');
          }
          if (
            visit.status !== AggregatorVisitStatus.CONFIRMED &&
            visit.status !== AggregatorVisitStatus.PROVISIONAL
          ) {
            throw new ConflictException(
              'Somente visita confirmada ou provisoria pode ser vinculada a entrada fisica',
            );
          }

          const accessEvent = await tx.accessEvent.findFirst({
            where: { id: accessEventId, gymId: tenantId },
            select: {
              id: true,
              studentId: true,
              allowed: true,
              occurredAt: true,
            },
          });
          if (!accessEvent) {
            throw new NotFoundException('Evento fisico nao encontrado');
          }
          if (!accessEvent.allowed) {
            throw new ConflictException('Evento fisico negado nao pode ser conciliado como entrada');
          }
          if (
            !visit.member.studentId ||
            !accessEvent.studentId ||
            visit.member.studentId !== accessEvent.studentId
          ) {
            throw new ConflictException(
              'Identidade do evento fisico nao corresponde ao membro aggregator',
            );
          }

          const existingByVisit =
            await tx.aggregatorAccessEventLink.findUnique({
              where: { visitAuthorizationId: visit.id },
            });
          if (existingByVisit) {
            if (existingByVisit.accessEventId !== accessEvent.id) {
              throw new ConflictException(
                'Autorizacao ja vinculada a outro evento fisico',
              );
            }
            return existingByVisit;
          }

          const existingByEvent =
            await tx.aggregatorAccessEventLink.findUnique({
              where: { accessEventId: accessEvent.id },
            });
          if (existingByEvent) {
            throw new ConflictException(
              'Evento fisico ja vinculado a outra autorizacao aggregator',
            );
          }

          const link = await tx.aggregatorAccessEventLink.create({
            data: {
              visitAuthorizationId: visit.id,
              accessEventId: accessEvent.id,
            },
          });

          await this.audit.record(
            {
              gymId: tenantId,
              userId: actorUserId ?? null,
              action: 'AGGREGATOR_PHYSICAL_ENTRY_LINKED',
              entity: 'AggregatorAccessEventLink',
              entityId: link.id,
              next: {
                visitAuthorizationId: link.visitAuthorizationId,
                accessEventId: link.accessEventId,
                occurredAt: accessEvent.occurredAt,
              },
            },
            tx,
          );

          return link;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  private async resolveStaleRisks(
    tx: Prisma.TransactionClient,
    visitAuthorizationId: string,
    currentType: string | null,
    now: Date,
  ) {
    const staleTypes = AGG7_RISK_TYPES.filter(
      (type) => type !== currentType && type !== 'ORPHAN_SETTLEMENT',
    );
    if (staleTypes.length === 0) {
      return 0;
    }
    const result = await tx.aggregatorRiskCase.updateMany({
      where: {
        visitAuthorizationId,
        type: { in: [...staleTypes] },
        status: { in: [AggregatorRiskStatus.OPEN, AggregatorRiskStatus.REVIEWING] },
      },
      data: {
        status: AggregatorRiskStatus.RESOLVED,
        resolvedAt: now,
      },
    });
    return result.count;
  }

  private async syncVisitRisk(
    tx: Prisma.TransactionClient,
    input: {
      connectionId: string;
      visitAuthorizationId: string;
      reconciliationId: string;
      settlement: SettlementFact | null;
      status: AggregatorReconciliationStatus;
      details: Prisma.InputJsonValue;
      gymId: string;
      actorUserId?: string;
      now: Date;
    },
  ) {
    const riskType = riskTypeFor(input.status);
    const resolvedCount = await this.resolveStaleRisks(
      tx,
      input.visitAuthorizationId,
      riskType,
      input.now,
    );

    if (resolvedCount > 0) {
      await this.audit.record(
        {
          gymId: input.gymId,
          userId: input.actorUserId ?? null,
          action: 'AGGREGATOR_RISK_CASES_RESOLVED',
          entity: 'AggregatorVisitAuthorization',
          entityId: input.visitAuthorizationId,
          next: { resolvedCount, reconciliationId: input.reconciliationId },
        },
        tx,
      );
    }

    if (!riskType) {
      return null;
    }

    const existingRisk = await tx.aggregatorRiskCase.findFirst({
      where: {
        connectionId: input.connectionId,
        visitAuthorizationId: input.visitAuthorizationId,
        type: riskType,
        status: { in: [AggregatorRiskStatus.OPEN, AggregatorRiskStatus.REVIEWING] },
      },
      orderBy: { createdAt: 'asc' },
    });

    const data = {
      reconciliationId: input.reconciliationId,
      settlementId: input.settlement?.id ?? null,
      potentialAmount: potentialAmount(input.status, input.settlement),
      currency: input.settlement?.currency ?? null,
      details: input.details,
    };

    const risk = existingRisk
      ? await tx.aggregatorRiskCase.update({
          where: { id: existingRisk.id },
          data,
        })
      : await tx.aggregatorRiskCase.create({
          data: {
            connectionId: input.connectionId,
            visitAuthorizationId: input.visitAuthorizationId,
            type: riskType,
            status: AggregatorRiskStatus.OPEN,
            ...data,
          },
        });

    await this.audit.record(
      {
        gymId: input.gymId,
        userId: input.actorUserId ?? null,
        action: existingRisk
          ? 'AGGREGATOR_RISK_CASE_UPDATED'
          : 'AGGREGATOR_RISK_CASE_OPENED',
        entity: 'AggregatorRiskCase',
        entityId: risk.id,
        next: {
          type: risk.type,
          status: risk.status,
          visitAuthorizationId: risk.visitAuthorizationId,
          settlementId: risk.settlementId,
          potentialAmount: risk.potentialAmount,
          currency: risk.currency,
        },
      },
      tx,
    );

    return risk;
  }

  async reconcileVisit(
    visitAuthorizationId: string,
    gymId?: string,
    actorUserId?: string,
  ) {
    const tenantId = this.requireGym(gymId);

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const visit = await tx.aggregatorVisitAuthorization.findFirst({
            where: {
              id: visitAuthorizationId,
              member: { connection: { gymId: tenantId } },
            },
            select: {
              id: true,
              externalVisitId: true,
              status: true,
              member: {
                select: {
                  connectionId: true,
                  studentId: true,
                },
              },
              accessEventLink: {
                include: {
                  accessEvent: {
                    select: {
                      id: true,
                      studentId: true,
                      allowed: true,
                      occurredAt: true,
                    },
                  },
                },
              },
              settlements: {
                orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
              },
            },
          });

          if (!visit) {
            throw new NotFoundException('Autorizacao de visita nao encontrada');
          }

          const settlement = visit.settlements[0] ?? null;
          const existingReconciliations =
            await tx.aggregatorReconciliation.findMany({
              where: { visitAuthorizationId: visit.id },
              orderBy: { createdAt: 'asc' },
            });

          let status = classifyThreeWayReconciliation({
            authorizationStatus: visit.status,
            physicalLinked: Boolean(visit.accessEventLink),
            physicalAllowed: visit.accessEventLink?.accessEvent.allowed ?? false,
            settlementCount: visit.settlements.length,
            settlement,
          });

          if (existingReconciliations.length > 1) {
            status = AggregatorReconciliationStatus.DUPLICATE;
          }

          const now = new Date();
          const details: Prisma.InputJsonValue = {
            version: RECONCILIATION_VERSION,
            facts: {
              authorization: {
                id: visit.id,
                status: visit.status,
                externalVisitId: visit.externalVisitId,
              },
              physicalEntry: visit.accessEventLink
                ? {
                    linkId: visit.accessEventLink.id,
                    accessEventId: visit.accessEventLink.accessEvent.id,
                    allowed: visit.accessEventLink.accessEvent.allowed,
                    occurredAt:
                      visit.accessEventLink.accessEvent.occurredAt.toISOString(),
                    identityMatches:
                      visit.member.studentId !== null &&
                      visit.member.studentId ===
                        visit.accessEventLink.accessEvent.studentId,
                  }
                : null,
              settlement: settlement
                ? {
                    id: settlement.id,
                    externalSettlementId: settlement.externalSettlementId,
                    externalVisitId: settlement.externalVisitId,
                    status: settlement.status,
                    amountExpected: settlement.amountExpected,
                    amountConfirmed: settlement.amountConfirmed,
                    currency: settlement.currency,
                  }
                : null,
              settlementCount: visit.settlements.length,
              reconciliationRecordCount: existingReconciliations.length,
            },
          };

          const existing = existingReconciliations[0] ?? null;
          const reconciliation = existing
            ? await tx.aggregatorReconciliation.update({
                where: { id: existing.id },
                data: {
                  accessEventLinkId: visit.accessEventLink?.id ?? null,
                  settlementId: settlement?.id ?? null,
                  status,
                  details,
                  reconciledAt:
                    status === AggregatorReconciliationStatus.RECONCILED
                      ? now
                      : null,
                },
              })
            : await tx.aggregatorReconciliation.create({
                data: {
                  visitAuthorizationId: visit.id,
                  accessEventLinkId: visit.accessEventLink?.id ?? null,
                  settlementId: settlement?.id ?? null,
                  status,
                  details,
                  reconciledAt:
                    status === AggregatorReconciliationStatus.RECONCILED
                      ? now
                      : null,
                },
              });

          const risk = await this.syncVisitRisk(tx, {
            connectionId: visit.member.connectionId,
            visitAuthorizationId: visit.id,
            reconciliationId: reconciliation.id,
            settlement,
            status,
            details,
            gymId: tenantId,
            actorUserId,
            now,
          });

          await this.audit.record(
            {
              gymId: tenantId,
              userId: actorUserId ?? null,
              action: 'AGGREGATOR_THREE_WAY_RECONCILIATION_RUN',
              entity: 'AggregatorReconciliation',
              entityId: reconciliation.id,
              previous: existing
                ? { status: existing.status, reconciledAt: existing.reconciledAt }
                : null,
              next: {
                status: reconciliation.status,
                visitAuthorizationId: reconciliation.visitAuthorizationId,
                accessEventLinkId: reconciliation.accessEventLinkId,
                settlementId: reconciliation.settlementId,
                reconciledAt: reconciliation.reconciledAt,
              },
            },
            tx,
          );

          return { reconciliation, risk };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async reconcileSettlement(
    settlementId: string,
    gymId?: string,
    actorUserId?: string,
  ) {
    const tenantId = this.requireGym(gymId);
    const settlement = await this.prisma.aggregatorSettlement.findFirst({
      where: {
        id: settlementId,
        connection: { gymId: tenantId },
      },
      select: { id: true, visitAuthorizationId: true },
    });

    if (!settlement) {
      throw new NotFoundException('Settlement nao encontrado');
    }
    if (settlement.visitAuthorizationId) {
      return this.reconcileVisit(
        settlement.visitAuthorizationId,
        tenantId,
        actorUserId,
      );
    }

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const orphan = await tx.aggregatorSettlement.findFirst({
            where: {
              id: settlementId,
              connection: { gymId: tenantId },
            },
            select: {
              id: true,
              connectionId: true,
              visitAuthorizationId: true,
              externalSettlementId: true,
              externalVisitId: true,
              status: true,
              amountExpected: true,
              amountConfirmed: true,
              currency: true,
            },
          });
          if (!orphan) {
            throw new NotFoundException('Settlement nao encontrado');
          }
          if (orphan.visitAuthorizationId) {
            throw new ConflictException(
              'Settlement foi vinculado a uma visita; execute a reconciliacao da visita',
            );
          }

          const now = new Date();
          const details: Prisma.InputJsonValue = {
            version: RECONCILIATION_VERSION,
            reason: 'ORPHAN_SETTLEMENT_WITHOUT_VISIT_AUTHORIZATION',
            settlement: {
              id: orphan.id,
              externalSettlementId: orphan.externalSettlementId,
              externalVisitId: orphan.externalVisitId,
              status: orphan.status,
              amountExpected: orphan.amountExpected,
              amountConfirmed: orphan.amountConfirmed,
              currency: orphan.currency,
            },
          };

          const existingReconciliation =
            await tx.aggregatorReconciliation.findFirst({
              where: { settlementId: orphan.id, visitAuthorizationId: null },
              orderBy: { createdAt: 'asc' },
            });
          const reconciliation = existingReconciliation
            ? await tx.aggregatorReconciliation.update({
                where: { id: existingReconciliation.id },
                data: {
                  status: AggregatorReconciliationStatus.MANUAL_REVIEW,
                  details,
                  reconciledAt: null,
                },
              })
            : await tx.aggregatorReconciliation.create({
                data: {
                  settlementId: orphan.id,
                  status: AggregatorReconciliationStatus.MANUAL_REVIEW,
                  details,
                },
              });

          const existingRisk = await tx.aggregatorRiskCase.findFirst({
            where: {
              connectionId: orphan.connectionId,
              settlementId: orphan.id,
              type: 'ORPHAN_SETTLEMENT',
              status: {
                in: [AggregatorRiskStatus.OPEN, AggregatorRiskStatus.REVIEWING],
              },
            },
            orderBy: { createdAt: 'asc' },
          });
          const riskData = {
            reconciliationId: reconciliation.id,
            potentialAmount: orphan.amountConfirmed ?? orphan.amountExpected,
            currency: orphan.currency,
            details,
          };
          const risk = existingRisk
            ? await tx.aggregatorRiskCase.update({
                where: { id: existingRisk.id },
                data: riskData,
              })
            : await tx.aggregatorRiskCase.create({
                data: {
                  connectionId: orphan.connectionId,
                  settlementId: orphan.id,
                  type: 'ORPHAN_SETTLEMENT',
                  status: AggregatorRiskStatus.OPEN,
                  ...riskData,
                },
              });

          await this.audit.record(
            {
              gymId: tenantId,
              userId: actorUserId ?? null,
              action: 'AGGREGATOR_ORPHAN_SETTLEMENT_REVIEWED',
              entity: 'AggregatorReconciliation',
              entityId: reconciliation.id,
              next: {
                status: reconciliation.status,
                settlementId: orphan.id,
                riskCaseId: risk.id,
                riskType: risk.type,
              },
            },
            tx,
          );

          return { reconciliation, risk };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }
}
