import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

function makeService(prisma) {
  const { AggregatorOperationsService } = require(
    '../dist/src/modules/aggregator/operations/aggregator-operations.service.js'
  );
  return new AggregatorOperationsService(prisma);
}

test('AGG8 controller derives tenant from authenticated identity and keeps financial queues away from RECEPTION', async () => {
  const controller = await source(
    'src/modules/aggregator/operations/aggregator-operations.controller.ts',
  );
  const dto = await source(
    'src/modules/aggregator/operations/dto/aggregator-operations-query.dto.ts',
  );

  assert.equal(dto.includes('gymId'), false);
  assert.equal(controller.includes('user.activeGymId ?? user.gymId'), true);
  assert.match(
    controller,
    /@Get\('risk-queue'\)\n  @Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER'\)/,
  );
  assert.match(
    controller,
    /@Get\('settlement-queue'\)\n  @Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER'\)/,
  );
  assert.match(
    controller,
    /@Get\('reception-queue'\)\n  @Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'\)/,
  );
});

test('AGG8 fails closed without an active tenant before performing any read', async () => {
  let reads = 0;
  const service = makeService({
    aggregatorProviderConnection: {
      groupBy: async () => {
        reads += 1;
        return [];
      },
    },
  });

  await assert.rejects(
    () => service.getSummary(undefined),
    (error) => {
      assert.equal(error.getStatus(), 400);
      return true;
    },
  );
  assert.equal(reads, 0);
});

test('AGG8 summary scopes every canonical operational projection to the authenticated gym', async () => {
  const seen = {};
  const service = makeService({
    aggregatorProviderConnection: {
      groupBy: async ({ where }) => {
        seen.connections = where;
        return [{ status: 'ACTIVE', _count: { _all: 2 } }];
      },
    },
    aggregatorVisitAuthorization: {
      groupBy: async ({ where }) => {
        seen.visits = where;
        return [{ status: 'CONFIRMED', _count: { _all: 4 } }];
      },
    },
    aggregatorSettlement: {
      groupBy: async ({ where }) => {
        seen.settlements = where;
        return [{ status: 'RECEIVED', _count: { _all: 3 } }];
      },
    },
    aggregatorReconciliation: {
      groupBy: async ({ where }) => {
        seen.reconciliations = where;
        return [{ status: 'RECONCILED', _count: { _all: 3 } }];
      },
    },
    aggregatorRiskCase: {
      groupBy: async ({ where }) => {
        seen.risks = where;
        return [
          { status: 'OPEN', _count: { _all: 1 } },
          { status: 'REVIEWING', _count: { _all: 2 } },
        ];
      },
    },
  });

  const result = await service.getSummary('gym-a');

  assert.deepEqual(seen.connections, { gymId: 'gym-a' });
  assert.deepEqual(seen.visits, {
    member: { connection: { gymId: 'gym-a' } },
  });
  assert.deepEqual(seen.settlements, {
    connection: { gymId: 'gym-a' },
  });
  assert.equal(
    seen.reconciliations.OR[0].visitAuthorization.member.connection.gymId,
    'gym-a',
  );
  assert.equal(
    seen.reconciliations.OR[1].settlement.connection.gymId,
    'gym-a',
  );
  assert.equal(seen.risks.connection.gymId, 'gym-a');
  assert.equal(result.connections.ACTIVE, 2);
  assert.equal(result.visits.CONFIRMED, 4);
  assert.equal(result.unresolvedRiskCases, 3);
});

test('AGG8 reception queue is deterministic, tenant scoped and never exposes financial amounts', async () => {
  let visitQuery;
  const now = new Date('2026-09-05T01:00:00.000Z');
  const service = makeService({
    aggregatorVisitAuthorization: {
      findMany: async (query) => {
        visitQuery = query;
        return [
          {
            id: 'visit-provisional',
            externalVisitId: 'ext-provisional',
            status: 'PROVISIONAL',
            requestedAt: now,
            authorizedAt: now,
            expiresAt: new Date('2026-09-05T01:10:00.000Z'),
            denialReason: null,
            member: {
              externalMemberId: 'member-a',
              providerStatus: 'active',
              connection: { providerCode: 'WELLHUB', status: 'ACTIVE' },
            },
            accessEventLink: null,
            provisionalDecision: {
              status: 'APPROVED',
              policyVersion: 'AGG6_V1',
              reason: 'TRANSIENT_PROVIDER_FAILURE',
              expiresAt: new Date('2026-09-05T01:10:00.000Z'),
            },
            revalidationAttempts: [
              {
                attempt: 1,
                status: 'UNKNOWN',
                reasonCode: 'PROVIDER_TIMEOUT',
                attemptedAt: now,
                completedAt: now,
              },
            ],
            reconciliations: [],
          },
          {
            id: 'visit-awaiting-entry',
            externalVisitId: 'ext-confirmed',
            status: 'CONFIRMED',
            requestedAt: now,
            authorizedAt: now,
            expiresAt: null,
            denialReason: null,
            member: {
              externalMemberId: 'member-b',
              providerStatus: 'active',
              connection: { providerCode: 'TOTALPASS', status: 'ACTIVE' },
            },
            accessEventLink: null,
            provisionalDecision: null,
            revalidationAttempts: [],
            reconciliations: [],
          },
          {
            id: 'visit-complete',
            externalVisitId: 'ext-complete',
            status: 'CONFIRMED',
            requestedAt: now,
            authorizedAt: now,
            expiresAt: null,
            denialReason: null,
            member: {
              externalMemberId: 'member-c',
              providerStatus: 'active',
              connection: { providerCode: 'WELLHUB', status: 'ACTIVE' },
            },
            accessEventLink: {
              linkedAt: now,
              accessEvent: { occurredAt: now },
            },
            provisionalDecision: null,
            revalidationAttempts: [],
            reconciliations: [
              { status: 'RECONCILED', reconciledAt: now, createdAt: now },
            ],
          },
        ];
      },
    },
  });

  const result = await service.getReceptionQueue('gym-a', 10);

  assert.equal(visitQuery.where.member.connection.gymId, 'gym-a');
  assert.equal(visitQuery.take <= 100, true);
  assert.equal(result.count, 2);
  assert.equal(result.items[0].attentionCode, 'REVALIDATION_REQUIRED');
  assert.equal(result.items[1].attentionCode, 'AWAITING_PHYSICAL_ENTRY');
  assert.equal(JSON.stringify(result).includes('amountExpected'), false);
  assert.equal(JSON.stringify(result).includes('amountConfirmed'), false);
  assert.equal(JSON.stringify(result).includes('potentialAmount'), false);
});

test('AGG8 manager queues remain tenant scoped and bound their maximum result size', async () => {
  let riskQuery;
  let settlementQuery;
  const service = makeService({
    aggregatorRiskCase: {
      findMany: async (query) => {
        riskQuery = query;
        return [];
      },
    },
    aggregatorSettlement: {
      findMany: async (query) => {
        settlementQuery = query;
        return [];
      },
    },
  });

  await service.getRiskQueue('gym-a', 500);
  await service.getSettlementQueue('gym-a', 500);

  assert.equal(riskQuery.where.connection.gymId, 'gym-a');
  assert.deepEqual(riskQuery.where.status.in, ['OPEN', 'REVIEWING']);
  assert.equal(riskQuery.take, 100);
  assert.equal(settlementQuery.where.connection.gymId, 'gym-a');
  assert.equal(settlementQuery.where.status.in.includes('RECEIVED'), false);
  assert.equal(settlementQuery.take, 100);
});

test('AGG8 service is a read-only projection layer and does not anticipate AGG9 intelligence', async () => {
  const serviceSource = await source(
    'src/modules/aggregator/operations/aggregator-operations.service.ts',
  );
  const doc = await source('docs/AGG8_RECEPTION_OPERATIONS_DASHBOARD.md');

  assert.equal(serviceSource.includes('.create('), false);
  assert.equal(serviceSource.includes('.update('), false);
  assert.equal(serviceSource.includes('.delete('), false);
  assert.equal(serviceSource.includes('$transaction'), false);
  assert.equal(serviceSource.includes('AuditService'), false);
  assert.equal(doc.includes('tendências, scoring, anomalias, predição'), true);
  assert.equal(doc.includes('pertencem ao AGG9'), true);
});
