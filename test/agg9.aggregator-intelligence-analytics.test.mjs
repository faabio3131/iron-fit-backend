import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

function makePrisma(overrides = {}) {
  return {
    aggregatorVisitAuthorization: { findMany: async () => [] },
    aggregatorSettlement: { findMany: async () => [] },
    aggregatorReconciliation: { findMany: async () => [] },
    aggregatorRiskCase: { findMany: async () => [] },
    ...overrides,
  };
}

function makeService(prisma) {
  const { AggregatorIntelligenceService } = require(
    '../dist/src/modules/aggregator/intelligence/aggregator-intelligence.service.js'
  );
  return new AggregatorIntelligenceService(prisma);
}

test('AGG9 controller is managerial-only and derives tenant from authenticated identity', async () => {
  const controller = await source(
    'src/modules/aggregator/intelligence/aggregator-intelligence.controller.ts',
  );
  const dto = await source(
    'src/modules/aggregator/intelligence/dto/aggregator-analytics-query.dto.ts',
  );

  assert.match(controller, /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER'\)/);
  assert.equal(controller.includes("'RECEPTION'"), false);
  assert.equal(controller.includes("'TRAINER'"), false);
  assert.equal(controller.includes("'STUDENT'"), false);
  assert.equal(controller.includes('user.activeGymId ?? user.gymId'), true);
  assert.equal(dto.includes('gymId'), false);
  assert.equal(dto.includes('@Max(90)'), true);
});

test('AGG9 fails closed without active tenant before any analytics read', async () => {
  let reads = 0;
  const service = makeService(
    makePrisma({
      aggregatorVisitAuthorization: {
        findMany: async () => {
          reads += 1;
          return [];
        },
      },
    }),
  );

  await assert.rejects(
    () => service.getOverview(undefined, 30),
    (error) => {
      assert.equal(error.getStatus(), 400);
      return true;
    },
  );
  assert.equal(reads, 0);
});

test('AGG9 overview scopes every source to Gym A and emits only advisory deterministic signals', async () => {
  const seen = {};
  const now = new Date();
  const service = makeService({
    aggregatorVisitAuthorization: {
      findMany: async (query) => {
        seen.visits = query;
        return [
          {
            status: 'PROVISIONAL',
            requestedAt: now,
            member: { connection: { providerCode: 'WELLHUB' } },
          },
          {
            status: 'CONFIRMED',
            requestedAt: now,
            member: { connection: { providerCode: 'WELLHUB' } },
          },
        ];
      },
    },
    aggregatorSettlement: {
      findMany: async (query) => {
        seen.settlements = query;
        return [
          {
            status: 'DIVERGENT',
            amountExpected: 1000,
            amountConfirmed: 900,
            currency: 'BRL',
            createdAt: now,
            connection: { providerCode: 'WELLHUB' },
          },
        ];
      },
    },
    aggregatorReconciliation: {
      findMany: async (query) => {
        seen.reconciliations = query;
        return [
          {
            status: 'AMOUNT_DIVERGENCE',
            createdAt: now,
            visitAuthorization: {
              member: { connection: { providerCode: 'WELLHUB' } },
            },
            settlement: { connection: { providerCode: 'WELLHUB' } },
          },
        ];
      },
    },
    aggregatorRiskCase: {
      findMany: async (query) => {
        seen.risks = query;
        return [
          {
            status: 'OPEN',
            type: 'AMOUNT_DIVERGENCE',
            potentialAmount: 100,
            currency: 'BRL',
            createdAt: now,
            connection: { providerCode: 'WELLHUB' },
          },
        ];
      },
    },
  });

  const result = await service.getOverview('gym-a', 30);

  assert.equal(seen.visits.where.member.connection.gymId, 'gym-a');
  assert.equal(seen.settlements.where.connection.gymId, 'gym-a');
  assert.equal(
    seen.reconciliations.where.OR[0].visitAuthorization.member.connection.gymId,
    'gym-a',
  );
  assert.equal(
    seen.reconciliations.where.OR[1].settlement.connection.gymId,
    'gym-a',
  );
  assert.equal(seen.risks.where.connection.gymId, 'gym-a');
  assert.equal(result.totals.visits, 2);
  assert.equal(result.totals.unresolvedRiskCases, 1);
  assert.equal(result.rates.confirmedVisitRate, 0.5);
  assert.deepEqual(
    result.signals.map((signal) => signal.code).sort(),
    [
      'PROVISIONAL_VISITS',
      'RECONCILIATION_GAPS',
      'SETTLEMENT_EXCEPTIONS',
      'UNRESOLVED_RISK_CASES',
    ].sort(),
  );
  assert.equal(result.signals.every((signal) => signal.advisory), true);
  assert.equal(
    result.signals.every((signal) => signal.criticalPathImpact === false),
    true,
  );
});

test('AGG9 provider analytics aggregate without PII and never mix currencies', async () => {
  const now = new Date();
  const service = makeService(
    makePrisma({
      aggregatorVisitAuthorization: {
        findMany: async () => [
          {
            status: 'CONFIRMED',
            requestedAt: now,
            member: { connection: { providerCode: 'WELLHUB' } },
          },
          {
            status: 'DENIED',
            requestedAt: now,
            member: { connection: { providerCode: 'TOTALPASS' } },
          },
        ],
      },
      aggregatorSettlement: {
        findMany: async () => [
          {
            status: 'RECEIVED',
            amountExpected: 1000,
            amountConfirmed: 1000,
            currency: 'BRL',
            createdAt: now,
            connection: { providerCode: 'WELLHUB' },
          },
          {
            status: 'RECEIVED',
            amountExpected: 50,
            amountConfirmed: 50,
            currency: 'USD',
            createdAt: now,
            connection: { providerCode: 'WELLHUB' },
          },
        ],
      },
      aggregatorReconciliation: {
        findMany: async () => [
          {
            status: 'RECONCILED',
            createdAt: now,
            visitAuthorization: {
              member: { connection: { providerCode: 'WELLHUB' } },
            },
            settlement: null,
          },
        ],
      },
      aggregatorRiskCase: {
        findMany: async () => [
          {
            status: 'OPEN',
            type: 'UNPAID_RISK',
            potentialAmount: 200,
            currency: 'BRL',
            createdAt: now,
            connection: { providerCode: 'WELLHUB' },
          },
        ],
      },
    }),
  );

  const result = await service.getProviders('gym-a', 30);
  const wellhub = result.items.find((item) => item.providerCode === 'WELLHUB');

  assert.ok(wellhub);
  assert.equal(wellhub.amountsByCurrency.BRL.expected, 1000);
  assert.equal(wellhub.amountsByCurrency.BRL.confirmed, 1000);
  assert.equal(wellhub.amountsByCurrency.BRL.potentialRisk, 200);
  assert.equal(wellhub.amountsByCurrency.USD.expected, 50);
  assert.equal(wellhub.amountsByCurrency.USD.confirmed, 50);
  assert.equal(JSON.stringify(result).includes('studentId'), false);
  assert.equal(JSON.stringify(result).includes('externalMemberId'), false);
  assert.equal(JSON.stringify(result).includes('memberId'), false);
});

test('AGG9 trends are bounded to 90 days and project canonical daily facts', async () => {
  const now = new Date();
  const service = makeService(
    makePrisma({
      aggregatorVisitAuthorization: {
        findMany: async () => [
          {
            status: 'CONFIRMED',
            requestedAt: now,
            member: { connection: { providerCode: 'WELLHUB' } },
          },
        ],
      },
      aggregatorSettlement: {
        findMany: async () => [
          {
            status: 'RECEIVED',
            amountExpected: 100,
            amountConfirmed: 100,
            currency: 'BRL',
            createdAt: now,
            connection: { providerCode: 'WELLHUB' },
          },
        ],
      },
      aggregatorReconciliation: {
        findMany: async () => [
          {
            status: 'RECONCILED',
            createdAt: now,
            visitAuthorization: {
              member: { connection: { providerCode: 'WELLHUB' } },
            },
            settlement: null,
          },
        ],
      },
      aggregatorRiskCase: {
        findMany: async () => [
          {
            status: 'RESOLVED',
            type: 'TEST',
            potentialAmount: null,
            currency: null,
            createdAt: now,
            connection: { providerCode: 'WELLHUB' },
          },
        ],
      },
    }),
  );

  const result = await service.getTrends('gym-a', 500);
  const today = result.points.at(-1);

  assert.equal(result.window.days, 90);
  assert.equal(result.points.length, 90);
  assert.equal(today.visits, 1);
  assert.equal(today.confirmedVisits, 1);
  assert.equal(today.receivedSettlements, 1);
  assert.equal(today.reconciled, 1);
  assert.equal(today.riskCasesCreated, 1);
});

test('AGG9 implementation stays read-only, provider-neutral and outside model-driven critical decisions', async () => {
  const serviceSource = await source(
    'src/modules/aggregator/intelligence/aggregator-intelligence.service.ts',
  );
  const controller = await source(
    'src/modules/aggregator/intelligence/aggregator-intelligence.controller.ts',
  );
  const doc = await source('docs/AGG9_AGGREGATOR_INTELLIGENCE_ANALYTICS.md');

  for (const mutation of ['.create(', '.update(', '.delete(', '.upsert(', '$transaction']) {
    assert.equal(serviceSource.includes(mutation), false, mutation);
  }
  assert.equal(serviceSource.includes('AuditService'), false);
  assert.equal(serviceSource.includes('WellhubAdapterService'), false);
  assert.equal(serviceSource.includes('TotalPassAdapterService'), false);
  assert.equal(controller.includes('@Post'), false);
  assert.equal(controller.includes('@Patch'), false);
  assert.equal(controller.includes('@Delete'), false);
  assert.equal(doc.includes('criticalPathImpact: false'), true);
  assert.equal(doc.includes('IRON Intelligence Layer (AI0/AI+)'), true);
  assert.equal(doc.includes('thresholds arbitrários'), true);
});
