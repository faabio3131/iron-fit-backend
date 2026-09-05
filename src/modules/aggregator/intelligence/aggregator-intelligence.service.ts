import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function countByStatus(items: Array<{ status: string }>) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return counts;
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

type ProviderAnalytics = {
  providerCode: string;
  visits: Record<string, number>;
  settlements: Record<string, number>;
  reconciliations: Record<string, number>;
  risks: Record<string, number>;
  amountsByCurrency: Record<
    string,
    { expected: number; confirmed: number; potentialRisk: number }
  >;
};

@Injectable()
export class AggregatorIntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  private requireGym(gymId?: string) {
    if (!gymId) {
      throw new BadRequestException('Tenant ativo obrigatorio');
    }
    return gymId;
  }

  private resolveWindow(days?: number) {
    const boundedDays = Number.isInteger(days)
      ? Math.max(1, Math.min(days as number, 90))
      : 30;
    const to = new Date();
    const since = new Date(to.getTime() - (boundedDays - 1) * DAY_MS);
    since.setUTCHours(0, 0, 0, 0);
    return { days: boundedDays, since, to };
  }

  private async loadDataset(gymId?: string, days?: number) {
    const tenantId = this.requireGym(gymId);
    const window = this.resolveWindow(days);

    const [visits, settlements, reconciliations, risks] = await Promise.all([
      this.prisma.aggregatorVisitAuthorization.findMany({
        where: {
          requestedAt: { gte: window.since, lte: window.to },
          member: { connection: { gymId: tenantId } },
        },
        select: {
          status: true,
          requestedAt: true,
          member: {
            select: {
              connection: { select: { providerCode: true } },
            },
          },
        },
      }),
      this.prisma.aggregatorSettlement.findMany({
        where: {
          createdAt: { gte: window.since, lte: window.to },
          connection: { gymId: tenantId },
        },
        select: {
          status: true,
          amountExpected: true,
          amountConfirmed: true,
          currency: true,
          createdAt: true,
          connection: { select: { providerCode: true } },
        },
      }),
      this.prisma.aggregatorReconciliation.findMany({
        where: {
          createdAt: { gte: window.since, lte: window.to },
          OR: [
            {
              visitAuthorization: {
                member: { connection: { gymId: tenantId } },
              },
            },
            { settlement: { connection: { gymId: tenantId } } },
          ],
        },
        select: {
          status: true,
          createdAt: true,
          visitAuthorization: {
            select: {
              member: {
                select: {
                  connection: { select: { providerCode: true } },
                },
              },
            },
          },
          settlement: {
            select: {
              connection: { select: { providerCode: true } },
            },
          },
        },
      }),
      this.prisma.aggregatorRiskCase.findMany({
        where: {
          createdAt: { gte: window.since, lte: window.to },
          connection: { gymId: tenantId },
        },
        select: {
          status: true,
          type: true,
          potentialAmount: true,
          currency: true,
          createdAt: true,
          connection: { select: { providerCode: true } },
        },
      }),
    ]);

    return { tenantId, window, visits, settlements, reconciliations, risks };
  }

  async getOverview(gymId?: string, days?: number) {
    const data = await this.loadDataset(gymId, days);
    const visitCounts = countByStatus(data.visits);
    const settlementCounts = countByStatus(data.settlements);
    const reconciliationCounts = countByStatus(data.reconciliations);
    const riskCounts = countByStatus(data.risks);

    const totalVisits = data.visits.length;
    const totalSettlements = data.settlements.length;
    const totalReconciliations = data.reconciliations.length;
    const unresolvedRiskCases =
      (riskCounts.OPEN ?? 0) + (riskCounts.REVIEWING ?? 0);
    const settlementExceptions =
      (settlementCounts.DIVERGENT ?? 0) +
      (settlementCounts.DISPUTED ?? 0) +
      (settlementCounts.EXPIRED ?? 0);
    const reconciliationGaps =
      totalReconciliations - (reconciliationCounts.RECONCILED ?? 0);

    const signals: Array<{
      code: string;
      count: number;
      severity: 'ATTENTION';
      advisory: true;
      criticalPathImpact: false;
    }> = [];

    if (unresolvedRiskCases > 0) {
      signals.push({
        code: 'UNRESOLVED_RISK_CASES',
        count: unresolvedRiskCases,
        severity: 'ATTENTION',
        advisory: true,
        criticalPathImpact: false,
      });
    }
    if (settlementExceptions > 0) {
      signals.push({
        code: 'SETTLEMENT_EXCEPTIONS',
        count: settlementExceptions,
        severity: 'ATTENTION',
        advisory: true,
        criticalPathImpact: false,
      });
    }
    if (reconciliationGaps > 0) {
      signals.push({
        code: 'RECONCILIATION_GAPS',
        count: reconciliationGaps,
        severity: 'ATTENTION',
        advisory: true,
        criticalPathImpact: false,
      });
    }
    if ((visitCounts.PROVISIONAL ?? 0) > 0) {
      signals.push({
        code: 'PROVISIONAL_VISITS',
        count: visitCounts.PROVISIONAL,
        severity: 'ATTENTION',
        advisory: true,
        criticalPathImpact: false,
      });
    }

    return {
      window: data.window,
      totals: {
        visits: totalVisits,
        settlements: totalSettlements,
        reconciliations: totalReconciliations,
        riskCases: data.risks.length,
        unresolvedRiskCases,
      },
      visitsByStatus: visitCounts,
      settlementsByStatus: settlementCounts,
      reconciliationsByStatus: reconciliationCounts,
      risksByStatus: riskCounts,
      rates: {
        confirmedVisitRate: ratio(visitCounts.CONFIRMED ?? 0, totalVisits),
        provisionalVisitRate: ratio(visitCounts.PROVISIONAL ?? 0, totalVisits),
        deniedOrFailedVisitRate: ratio(
          (visitCounts.DENIED ?? 0) + (visitCounts.FAILED ?? 0),
          totalVisits,
        ),
        receivedSettlementRate: ratio(
          settlementCounts.RECEIVED ?? 0,
          totalSettlements,
        ),
        settlementExceptionRate: ratio(
          settlementExceptions,
          totalSettlements,
        ),
        reconciledRate: ratio(
          reconciliationCounts.RECONCILED ?? 0,
          totalReconciliations,
        ),
      },
      signals,
      generatedAt: new Date(),
    };
  }

  private ensureProvider(
    providers: Map<string, ProviderAnalytics>,
    providerCode: string,
  ) {
    let current = providers.get(providerCode);
    if (!current) {
      current = {
        providerCode,
        visits: {},
        settlements: {},
        reconciliations: {},
        risks: {},
        amountsByCurrency: {},
      };
      providers.set(providerCode, current);
    }
    return current;
  }

  private increment(bucket: Record<string, number>, key: string) {
    bucket[key] = (bucket[key] ?? 0) + 1;
  }

  async getProviders(gymId?: string, days?: number) {
    const data = await this.loadDataset(gymId, days);
    const providers = new Map<string, ProviderAnalytics>();

    for (const visit of data.visits) {
      const provider = this.ensureProvider(
        providers,
        visit.member.connection.providerCode,
      );
      this.increment(provider.visits, visit.status);
    }

    for (const settlement of data.settlements) {
      const provider = this.ensureProvider(
        providers,
        settlement.connection.providerCode,
      );
      this.increment(provider.settlements, settlement.status);
      const currency = settlement.currency ?? 'UNSPECIFIED';
      provider.amountsByCurrency[currency] ??= {
        expected: 0,
        confirmed: 0,
        potentialRisk: 0,
      };
      provider.amountsByCurrency[currency].expected +=
        settlement.amountExpected ?? 0;
      provider.amountsByCurrency[currency].confirmed +=
        settlement.amountConfirmed ?? 0;
    }

    for (const reconciliation of data.reconciliations) {
      const providerCode =
        reconciliation.visitAuthorization?.member.connection.providerCode ??
        reconciliation.settlement?.connection.providerCode ??
        'UNATTRIBUTED';
      const provider = this.ensureProvider(providers, providerCode);
      this.increment(provider.reconciliations, reconciliation.status);
    }

    for (const risk of data.risks) {
      const provider = this.ensureProvider(
        providers,
        risk.connection.providerCode,
      );
      this.increment(provider.risks, risk.status);
      const currency = risk.currency ?? 'UNSPECIFIED';
      provider.amountsByCurrency[currency] ??= {
        expected: 0,
        confirmed: 0,
        potentialRisk: 0,
      };
      provider.amountsByCurrency[currency].potentialRisk +=
        risk.potentialAmount ?? 0;
    }

    const items = [...providers.values()]
      .map((provider) => {
        const totalVisits = Object.values(provider.visits).reduce(
          (sum, value) => sum + value,
          0,
        );
        const totalSettlements = Object.values(provider.settlements).reduce(
          (sum, value) => sum + value,
          0,
        );
        const totalReconciliations = Object.values(
          provider.reconciliations,
        ).reduce((sum, value) => sum + value, 0);
        return {
          ...provider,
          rates: {
            confirmedVisitRate: ratio(
              provider.visits.CONFIRMED ?? 0,
              totalVisits,
            ),
            receivedSettlementRate: ratio(
              provider.settlements.RECEIVED ?? 0,
              totalSettlements,
            ),
            reconciledRate: ratio(
              provider.reconciliations.RECONCILED ?? 0,
              totalReconciliations,
            ),
          },
        };
      })
      .sort((a, b) => a.providerCode.localeCompare(b.providerCode));

    return {
      window: data.window,
      items,
      generatedAt: new Date(),
    };
  }

  async getTrends(gymId?: string, days?: number) {
    const data = await this.loadDataset(gymId, days);
    const points = new Map<
      string,
      {
        date: string;
        visits: number;
        confirmedVisits: number;
        provisionalVisits: number;
        deniedOrFailedVisits: number;
        receivedSettlements: number;
        settlementExceptions: number;
        reconciled: number;
        reconciliationGaps: number;
        riskCasesCreated: number;
      }
    >();

    for (let index = 0; index < data.window.days; index += 1) {
      const day = new Date(data.window.since.getTime() + index * DAY_MS);
      const key = dateKey(day);
      points.set(key, {
        date: key,
        visits: 0,
        confirmedVisits: 0,
        provisionalVisits: 0,
        deniedOrFailedVisits: 0,
        receivedSettlements: 0,
        settlementExceptions: 0,
        reconciled: 0,
        reconciliationGaps: 0,
        riskCasesCreated: 0,
      });
    }

    for (const visit of data.visits) {
      const bucket = points.get(dateKey(visit.requestedAt));
      if (!bucket) continue;
      bucket.visits += 1;
      if (visit.status === 'CONFIRMED') bucket.confirmedVisits += 1;
      if (visit.status === 'PROVISIONAL') bucket.provisionalVisits += 1;
      if (visit.status === 'DENIED' || visit.status === 'FAILED') {
        bucket.deniedOrFailedVisits += 1;
      }
    }

    for (const settlement of data.settlements) {
      const bucket = points.get(dateKey(settlement.createdAt));
      if (!bucket) continue;
      if (settlement.status === 'RECEIVED') bucket.receivedSettlements += 1;
      if (
        settlement.status === 'DIVERGENT' ||
        settlement.status === 'DISPUTED' ||
        settlement.status === 'EXPIRED'
      ) {
        bucket.settlementExceptions += 1;
      }
    }

    for (const reconciliation of data.reconciliations) {
      const bucket = points.get(dateKey(reconciliation.createdAt));
      if (!bucket) continue;
      if (reconciliation.status === 'RECONCILED') bucket.reconciled += 1;
      else bucket.reconciliationGaps += 1;
    }

    for (const risk of data.risks) {
      const bucket = points.get(dateKey(risk.createdAt));
      if (bucket) bucket.riskCasesCreated += 1;
    }

    return {
      window: data.window,
      points: [...points.values()],
      generatedAt: new Date(),
    };
  }
}
