import { BadRequestException, Injectable } from '@nestjs/common';
import { CreatorRightsScope } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;

export type CreatorAnalyticsContext = {
  scope: CreatorRightsScope;
  gymId: string | null;
};

function countRecord<K extends string>(
  rows: Array<{ key: K; count: number }>,
): Record<K, number> {
  const output = {} as Record<K, number>;
  for (const row of rows) {
    output[row.key] = row.count;
  }
  return output;
}

function minorString(value: number | null | undefined) {
  return BigInt(value ?? 0).toString();
}

@Injectable()
export class CreatorAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveWindow(daysInput?: string) {
    const days = daysInput === undefined ? DEFAULT_WINDOW_DAYS : Number(daysInput);
    if (!Number.isInteger(days) || days < 1 || days > MAX_WINDOW_DAYS) {
      throw new BadRequestException(
        `days deve ser inteiro entre 1 e ${MAX_WINDOW_DAYS}`,
      );
    }
    const to = new Date();
    const since = new Date(to.getTime() - (days - 1) * DAY_MS);
    since.setUTCHours(0, 0, 0, 0);
    return { days, since, to };
  }

  async getAnalytics(context: CreatorAnalyticsContext, daysInput?: string) {
    const window = this.resolveWindow(daysInput);
    const tenantUsageWhere =
      context.scope === CreatorRightsScope.TENANT
        ? { gymId: context.gymId as string }
        : {};
    const tenantEventWhere =
      context.scope === CreatorRightsScope.TENANT
        ? { usageSession: { gymId: context.gymId as string } }
        : {};
    const tenantAccrualWhere =
      context.scope === CreatorRightsScope.TENANT
        ? { consumptionGymId: context.gymId as string }
        : {};
    const tenantSettlementWhere =
      context.scope === CreatorRightsScope.TENANT
        ? {
            scope: CreatorRightsScope.TENANT,
            gymId: context.gymId as string,
          }
        : {};

    const [
      usageSessionRows,
      usageEventRows,
      observationRows,
      accrualRows,
      settlementRows,
    ] = await Promise.all([
      this.prisma.creatorContentUsageSession.groupBy({
        by: ['deliveryKind'],
        where: {
          ...tenantUsageWhere,
          createdAt: { gte: window.since, lte: window.to },
        },
        _count: { _all: true },
      }),
      this.prisma.creatorContentUsageEvent.groupBy({
        by: ['eventType'],
        where: {
          ...tenantEventWhere,
          observedAt: { gte: window.since, lte: window.to },
        },
        _count: { _all: true },
      }),
      this.prisma.creatorContentUsageEvent.groupBy({
        by: ['observationSource'],
        where: {
          ...tenantEventWhere,
          observedAt: { gte: window.since, lte: window.to },
        },
        _count: { _all: true },
      }),
      this.prisma.creatorCommercialAccrual.groupBy({
        by: ['currency'],
        where: {
          ...tenantAccrualWhere,
          sourceEventObservedAt: { gte: window.since, lte: window.to },
        },
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
      this.prisma.creatorSettlementBatch.groupBy({
        by: ['currency', 'status'],
        where: {
          ...tenantSettlementWhere,
          finalizedAt: { gte: window.since, lte: window.to },
        },
        _count: { _all: true },
        _sum: { totalAmountMinor: true },
      }),
    ]);

    const sessionsByDeliveryKind = countRecord(
      usageSessionRows.map((row) => ({
        key: row.deliveryKind,
        count: row._count._all,
      })),
    );
    const eventsByType = countRecord(
      usageEventRows.map((row) => ({
        key: row.eventType,
        count: row._count._all,
      })),
    );
    const eventsByObservationSource = countRecord(
      observationRows.map((row) => ({
        key: row.observationSource,
        count: row._count._all,
      })),
    );

    const accrualsByCurrency = accrualRows
      .map((row) => ({
        currency: row.currency,
        accrualCount: row._count._all,
        totalAmountMinor: minorString(row._sum.amountMinor),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    const settlementByCurrency = new Map<
      string,
      {
        currency: string;
        statuses: Record<string, { count: number; totalAmountMinor: string }>;
      }
    >();
    for (const row of settlementRows) {
      let currency = settlementByCurrency.get(row.currency);
      if (!currency) {
        currency = { currency: row.currency, statuses: {} };
        settlementByCurrency.set(row.currency, currency);
      }
      currency.statuses[row.status] = {
        count: row._count._all,
        totalAmountMinor: minorString(row._sum.totalAmountMinor),
      };
    }

    const totalSessions = usageSessionRows.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );
    const totalEvents = usageEventRows.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );

    return {
      scope: context.scope,
      window,
      usage: {
        totalSessions,
        totalEvents,
        sessionsByDeliveryKind,
        eventsByType,
        eventsByObservationSource,
      },
      commercial: {
        accrualsByConsumptionCurrency: accrualsByCurrency,
        settlementBatchesByCurrency: [...settlementByCurrency.values()].sort(
          (a, b) => a.currency.localeCompare(b.currency),
        ),
      },
      generatedAt: new Date(),
    };
  }
}
