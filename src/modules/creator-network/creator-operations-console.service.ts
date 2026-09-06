import { Injectable } from '@nestjs/common';
import {
  CreatorRightsGrantStatus,
  CreatorRightsScope,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const RIGHTS_ATTENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CreatorOperationsContext = {
  scope: CreatorRightsScope;
  gymId: string | null;
};

function keyedCounts<K extends string>(
  rows: Array<{ key: K; count: number }>,
): Record<K, number> {
  const output = {} as Record<K, number>;
  for (const row of rows) {
    output[row.key] = row.count;
  }
  return output;
}

@Injectable()
export class CreatorOperationsConsoleService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(context: CreatorOperationsContext) {
    const now = new Date();
    const attentionUntil = new Date(
      now.getTime() + RIGHTS_ATTENTION_DAYS * DAY_MS,
    );
    const scopedContent = {
      scope: context.scope,
      gymId: context.gymId,
    };
    const scopedGrant = {
      scope: context.scope,
      gymId: context.gymId,
    };
    const creatorWhere =
      context.scope === CreatorRightsScope.TENANT
        ? { contents: { some: scopedContent } }
        : undefined;

    const [
      creatorRows,
      grantRows,
      effectiveRightsCount,
      expiringRightsCount,
      expiredActiveRightsCount,
      contentRows,
      versionRows,
      reviewRows,
      ingestionRows,
      failureRows,
      mappingRows,
    ] = await Promise.all([
      this.prisma.creator.groupBy({
        by: ['status'],
        where: creatorWhere,
        _count: { _all: true },
      }),
      this.prisma.creatorRightsGrantVersion.groupBy({
        by: ['status'],
        where: { grant: scopedGrant },
        _count: { _all: true },
      }),
      this.prisma.creatorRightsGrantVersion.count({
        where: {
          grant: scopedGrant,
          status: CreatorRightsGrantStatus.ACTIVE,
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        },
      }),
      this.prisma.creatorRightsGrantVersion.count({
        where: {
          grant: scopedGrant,
          status: CreatorRightsGrantStatus.ACTIVE,
          validFrom: { lte: now },
          validUntil: { gt: now, lte: attentionUntil },
        },
      }),
      this.prisma.creatorRightsGrantVersion.count({
        where: {
          grant: scopedGrant,
          status: CreatorRightsGrantStatus.ACTIVE,
          validUntil: { lte: now },
        },
      }),
      this.prisma.creatorContent.groupBy({
        by: ['lifecycleStatus'],
        where: scopedContent,
        _count: { _all: true },
      }),
      this.prisma.creatorContentVersion.groupBy({
        by: ['status'],
        where: { content: scopedContent },
        _count: { _all: true },
      }),
      this.prisma.creatorContentReview.groupBy({
        by: ['decision'],
        where: { version: { content: scopedContent } },
        _count: { _all: true },
      }),
      this.prisma.creatorMediaIngestion.groupBy({
        by: ['status'],
        where: { mediaAsset: { content: scopedContent } },
        _count: { _all: true },
      }),
      this.prisma.creatorMediaIngestion.groupBy({
        by: ['failureCode'],
        where: {
          mediaAsset: { content: scopedContent },
          failureCode: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.creatorExerciseContentMapping.groupBy({
        by: ['status'],
        where: scopedContent,
        _count: { _all: true },
      }),
    ]);

    const creatorsByStatus = keyedCounts(
      creatorRows.map((row) => ({ key: row.status, count: row._count._all })),
    );
    const grantVersionsByStatus = keyedCounts(
      grantRows.map((row) => ({ key: row.status, count: row._count._all })),
    );
    const contentByLifecycle = keyedCounts(
      contentRows.map((row) => ({
        key: row.lifecycleStatus,
        count: row._count._all,
      })),
    );
    const versionsByStatus = keyedCounts(
      versionRows.map((row) => ({ key: row.status, count: row._count._all })),
    );
    const reviewsByDecision = keyedCounts(
      reviewRows.map((row) => ({ key: row.decision, count: row._count._all })),
    );
    const ingestionsByStatus = keyedCounts(
      ingestionRows.map((row) => ({ key: row.status, count: row._count._all })),
    );
    const ingestionFailuresByCode: Record<string, number> = {};
    for (const row of failureRows) {
      if (row.failureCode) {
        ingestionFailuresByCode[row.failureCode] = row._count._all;
      }
    }
    const mappingsByStatus = keyedCounts(
      mappingRows.map((row) => ({ key: row.status, count: row._count._all })),
    );

    return {
      scope: context.scope,
      generatedAt: now,
      creators: {
        byStatus: creatorsByStatus,
      },
      rights: {
        grantVersionsByStatus,
        effectiveActive: effectiveRightsCount,
        expiringWithinDays: {
          days: RIGHTS_ATTENTION_DAYS,
          count: expiringRightsCount,
        },
        expiredButStillActiveRecords: expiredActiveRightsCount,
      },
      content: {
        byLifecycle: contentByLifecycle,
        versionsByStatus,
        reviewsByDecision,
      },
      media: {
        ingestionsByStatus,
        failuresByCode: ingestionFailuresByCode,
      },
      publishing: {
        mappingsByStatus,
      },
    };
  }
}
