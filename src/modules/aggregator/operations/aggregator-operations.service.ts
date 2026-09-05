import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AggregatorReconciliationStatus,
  AggregatorRiskStatus,
  AggregatorSettlementStatus,
  AggregatorVisitStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

type CountRow = {
  status: string;
  _count: { _all: number };
};

function toCountMap(rows: CountRow[]) {
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

@Injectable()
export class AggregatorOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireGym(gymId?: string) {
    if (!gymId) {
      throw new BadRequestException('Tenant ativo obrigatorio');
    }
    return gymId;
  }

  private boundedLimit(limit?: number) {
    if (!Number.isInteger(limit) || !limit) return 25;
    return Math.max(1, Math.min(limit, 100));
  }

  async getSummary(gymId?: string) {
    const tenantId = this.requireGym(gymId);

    const [connections, visits, settlements, reconciliations, risks] =
      await Promise.all([
        this.prisma.aggregatorProviderConnection.groupBy({
          by: ['status'],
          where: { gymId: tenantId },
          _count: { _all: true },
        }),
        this.prisma.aggregatorVisitAuthorization.groupBy({
          by: ['status'],
          where: { member: { connection: { gymId: tenantId } } },
          _count: { _all: true },
        }),
        this.prisma.aggregatorSettlement.groupBy({
          by: ['status'],
          where: { connection: { gymId: tenantId } },
          _count: { _all: true },
        }),
        this.prisma.aggregatorReconciliation.groupBy({
          by: ['status'],
          where: {
            OR: [
              {
                visitAuthorization: {
                  member: { connection: { gymId: tenantId } },
                },
              },
              { settlement: { connection: { gymId: tenantId } } },
            ],
          },
          _count: { _all: true },
        }),
        this.prisma.aggregatorRiskCase.groupBy({
          by: ['status'],
          where: {
            connection: { gymId: tenantId },
            status: {
              in: [AggregatorRiskStatus.OPEN, AggregatorRiskStatus.REVIEWING],
            },
          },
          _count: { _all: true },
        }),
      ]);

    const riskCounts = toCountMap(risks);

    return {
      connections: toCountMap(connections),
      visits: toCountMap(visits),
      settlements: toCountMap(settlements),
      reconciliations: toCountMap(reconciliations),
      risks: riskCounts,
      unresolvedRiskCases:
        (riskCounts[AggregatorRiskStatus.OPEN] ?? 0) +
        (riskCounts[AggregatorRiskStatus.REVIEWING] ?? 0),
      generatedAt: new Date(),
    };
  }

  async getReceptionQueue(gymId?: string, limit?: number) {
    const tenantId = this.requireGym(gymId);
    const boundedLimit = this.boundedLimit(limit);

    const visits = await this.prisma.aggregatorVisitAuthorization.findMany({
      where: { member: { connection: { gymId: tenantId } } },
      select: {
        id: true,
        externalVisitId: true,
        status: true,
        requestedAt: true,
        authorizedAt: true,
        expiresAt: true,
        denialReason: true,
        member: {
          select: {
            externalMemberId: true,
            providerStatus: true,
            connection: {
              select: {
                providerCode: true,
                status: true,
              },
            },
          },
        },
        accessEventLink: {
          select: {
            linkedAt: true,
            accessEvent: {
              select: {
                occurredAt: true,
              },
            },
          },
        },
        provisionalDecision: {
          select: {
            status: true,
            policyVersion: true,
            reason: true,
            expiresAt: true,
          },
        },
        revalidationAttempts: {
          orderBy: { attempt: 'desc' },
          take: 1,
          select: {
            attempt: true,
            status: true,
            reasonCode: true,
            attemptedAt: true,
            completedAt: true,
          },
        },
        reconciliations: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            status: true,
            reconciledAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: Math.min(boundedLimit * 4, 100),
    });

    const queue = visits
      .map((visit) => {
        const latestReconciliation = visit.reconciliations[0] ?? null;
        const latestRevalidation = visit.revalidationAttempts[0] ?? null;
        let attentionCode: string | null = null;

        if (visit.status === AggregatorVisitStatus.PROVISIONAL) {
          attentionCode = 'REVALIDATION_REQUIRED';
        } else if (visit.status === AggregatorVisitStatus.PENDING) {
          attentionCode = 'AUTHORIZATION_PENDING';
        } else if (
          visit.status === AggregatorVisitStatus.DENIED ||
          visit.status === AggregatorVisitStatus.FAILED
        ) {
          attentionCode = 'AUTHORIZATION_FAILED';
        } else if (
          visit.status === AggregatorVisitStatus.CONFIRMED &&
          !visit.accessEventLink
        ) {
          attentionCode = 'AWAITING_PHYSICAL_ENTRY';
        } else if (
          latestReconciliation &&
          latestReconciliation.status !== AggregatorReconciliationStatus.RECONCILED
        ) {
          attentionCode = `RECONCILIATION_${latestReconciliation.status}`;
        } else if (
          visit.status === AggregatorVisitStatus.CONFIRMED &&
          visit.accessEventLink &&
          !latestReconciliation
        ) {
          attentionCode = 'RECONCILIATION_REQUIRED';
        }

        if (!attentionCode) return null;

        return {
          visitAuthorizationId: visit.id,
          externalVisitId: visit.externalVisitId,
          externalMemberId: visit.member.externalMemberId,
          providerCode: visit.member.connection.providerCode,
          providerConnectionStatus: visit.member.connection.status,
          providerMemberStatus: visit.member.providerStatus,
          visitStatus: visit.status,
          requestedAt: visit.requestedAt,
          authorizedAt: visit.authorizedAt,
          expiresAt: visit.expiresAt,
          denialReason: visit.denialReason,
          physicalEntry: visit.accessEventLink
            ? {
                linkedAt: visit.accessEventLink.linkedAt,
                occurredAt: visit.accessEventLink.accessEvent.occurredAt,
              }
            : null,
          provisionalDecision: visit.provisionalDecision,
          latestRevalidation,
          reconciliationStatus: latestReconciliation?.status ?? null,
          attentionCode,
        };
      })
      .filter((item) => item !== null)
      .slice(0, boundedLimit);

    return {
      items: queue,
      count: queue.length,
      generatedAt: new Date(),
    };
  }

  async getRiskQueue(gymId?: string, limit?: number) {
    const tenantId = this.requireGym(gymId);
    const boundedLimit = this.boundedLimit(limit);

    return this.prisma.aggregatorRiskCase.findMany({
      where: {
        connection: { gymId: tenantId },
        status: {
          in: [AggregatorRiskStatus.OPEN, AggregatorRiskStatus.REVIEWING],
        },
      },
      select: {
        id: true,
        type: true,
        status: true,
        potentialAmount: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        connection: {
          select: { providerCode: true, status: true },
        },
        visitAuthorization: {
          select: {
            id: true,
            externalVisitId: true,
            status: true,
          },
        },
        reconciliation: {
          select: {
            id: true,
            status: true,
            reconciledAt: true,
          },
        },
        settlement: {
          select: {
            id: true,
            externalSettlementId: true,
            externalVisitId: true,
            status: true,
            amountExpected: true,
            amountConfirmed: true,
            currency: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: boundedLimit,
    });
  }

  async getSettlementQueue(gymId?: string, limit?: number) {
    const tenantId = this.requireGym(gymId);
    const boundedLimit = this.boundedLimit(limit);

    return this.prisma.aggregatorSettlement.findMany({
      where: {
        connection: { gymId: tenantId },
        status: {
          in: [
            AggregatorSettlementStatus.EXPECTED,
            AggregatorSettlementStatus.CONFIRMED,
            AggregatorSettlementStatus.DIVERGENT,
            AggregatorSettlementStatus.DISPUTED,
            AggregatorSettlementStatus.EXPIRED,
          ],
        },
      },
      select: {
        id: true,
        externalSettlementId: true,
        externalVisitId: true,
        status: true,
        amountExpected: true,
        amountConfirmed: true,
        currency: true,
        providerStatus: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
        updatedAt: true,
        connection: {
          select: { providerCode: true, status: true },
        },
        visitAuthorization: {
          select: {
            id: true,
            externalVisitId: true,
            status: true,
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: boundedLimit,
    });
  }
}
