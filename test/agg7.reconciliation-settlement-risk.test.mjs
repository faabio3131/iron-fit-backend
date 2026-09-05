import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

function receivedSettlement(overrides = {}) {
  return {
    id: 'settlement-a',
    connectionId: 'connection-a',
    visitAuthorizationId: 'visit-a',
    externalSettlementId: 'settlement-ext-a',
    externalVisitId: 'visit-ext-a',
    status: 'RECEIVED',
    amountExpected: 2500,
    amountConfirmed: 2500,
    currency: 'BRL',
    providerStatus: 'paid',
    provenance: { source: 'AGG7_SETTLEMENT_LEDGER' },
    periodStart: null,
    periodEnd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function reconciliableVisit(overrides = {}) {
  return {
    id: 'visit-a',
    externalVisitId: 'visit-ext-a',
    status: 'CONFIRMED',
    member: { connectionId: 'connection-a', studentId: 'student-a' },
    accessEventLink: {
      id: 'link-a',
      accessEventId: 'access-a',
      visitAuthorizationId: 'visit-a',
      linkedAt: new Date(),
      accessEvent: {
        id: 'access-a',
        studentId: 'student-a',
        allowed: true,
        occurredAt: new Date(),
      },
    },
    settlements: [receivedSettlement()],
    ...overrides,
  };
}

function makeReconciliationService(tx, extraPrisma = {}) {
  const { AggregatorReconciliationService } = require(
    '../dist/src/modules/aggregator/reconciliation/aggregator-reconciliation.service.js'
  );
  const audits = [];
  const prisma = {
    ...extraPrisma,
    $transaction: async (callback, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return callback(tx);
    },
  };
  const service = new AggregatorReconciliationService(prisma, {
    record: async (input) => audits.push(input),
  });
  return { service, audits };
}

test('AGG7 controllers derive tenant from authenticated identity and DTO never accepts gymId', async () => {
  const settlementController = await source(
    'src/modules/aggregator/settlements/aggregator-settlement.controller.ts',
  );
  const reconciliationController = await source(
    'src/modules/aggregator/reconciliation/aggregator-reconciliation.controller.ts',
  );
  const dto = await source(
    'src/modules/aggregator/settlements/dto/record-aggregator-settlement.dto.ts',
  );

  assert.equal(dto.includes('gymId'), false);
  assert.equal(settlementController.includes('user.activeGymId ?? user.gymId'), true);
  assert.equal(reconciliationController.includes('user.activeGymId ?? user.gymId'), true);
});

test('AGG7 settlement ledger is tenant scoped and physically idempotent by external settlement id', async () => {
  const { AggregatorSettlementLedgerService } = require(
    '../dist/src/modules/aggregator/settlements/aggregator-settlement-ledger.service.js'
  );

  let connectionWhere;
  let uniqueWhere;
  let createdData;
  const audits = [];
  const service = new AggregatorSettlementLedgerService(
    {
      $transaction: async (callback, options) => {
        assert.equal(options.isolationLevel, 'Serializable');
        return callback({
          aggregatorProviderConnection: {
            findFirst: async ({ where }) => {
              connectionWhere = where;
              return { id: 'connection-a', providerCode: 'TOTALPASS' };
            },
          },
          aggregatorVisitAuthorization: {
            findFirst: async () => ({ id: 'visit-a' }),
          },
          aggregatorSettlement: {
            findUnique: async ({ where }) => {
              uniqueWhere = where;
              return null;
            },
            create: async ({ data }) => {
              createdData = data;
              return {
                id: 'settlement-a',
                createdAt: new Date(),
                updatedAt: new Date(),
                ...data,
              };
            },
          },
        });
      },
    },
    { record: async (input) => audits.push(input) },
  );

  const result = await service.recordProviderSettlement(
    {
      connectionId: 'connection-a',
      externalSettlementId: 'settlement-ext-a',
      externalVisitId: 'visit-ext-a',
      status: 'RECEIVED',
      amountExpected: 2500,
      amountConfirmed: 2500,
      currency: 'BRL',
      evidenceRef: 'provider-evidence-a',
    },
    'gym-a',
    'manager-a',
  );

  assert.deepEqual(connectionWhere, { id: 'connection-a', gymId: 'gym-a' });
  assert.equal(
    uniqueWhere.connectionId_externalSettlementId.externalSettlementId,
    'settlement-ext-a',
  );
  assert.equal(createdData.visitAuthorizationId, 'visit-a');
  assert.equal(result.status, 'RECEIVED');
  assert.ok(
    audits.some(
      (audit) => audit.action === 'AGGREGATOR_SETTLEMENT_EVIDENCE_RECORDED',
    ),
  );
});

test('AGG7 settlement ledger rejects cross-tenant connection before mutation', async () => {
  const { AggregatorSettlementLedgerService } = require(
    '../dist/src/modules/aggregator/settlements/aggregator-settlement-ledger.service.js'
  );
  let writes = 0;
  const service = new AggregatorSettlementLedgerService(
    {
      $transaction: async (callback) =>
        callback({
          aggregatorProviderConnection: { findFirst: async () => null },
          aggregatorSettlement: {
            create: async () => {
              writes += 1;
            },
          },
        }),
    },
    { record: async () => undefined },
  );

  await assert.rejects(
    () =>
      service.recordProviderSettlement(
        {
          connectionId: 'connection-b',
          externalSettlementId: 'settlement-b',
          status: 'EXPECTED',
        },
        'gym-a',
      ),
    (error) => {
      assert.equal(error.getStatus(), 404);
      return true;
    },
  );
  assert.equal(writes, 0);
});

test('AGG7 physical link requires same tenant, allowed event and exact local student identity', async () => {
  let visitWhere;
  let eventWhere;
  let createdLink;
  const tx = {
    aggregatorVisitAuthorization: {
      findFirst: async ({ where }) => {
        visitWhere = where;
        return {
          id: 'visit-a',
          status: 'CONFIRMED',
          member: { studentId: 'student-a' },
        };
      },
    },
    accessEvent: {
      findFirst: async ({ where }) => {
        eventWhere = where;
        return {
          id: 'access-a',
          studentId: 'student-a',
          allowed: true,
          occurredAt: new Date(),
        };
      },
    },
    aggregatorAccessEventLink: {
      findUnique: async () => null,
      create: async ({ data }) => {
        createdLink = { id: 'link-a', ...data };
        return createdLink;
      },
    },
  };
  const { service } = makeReconciliationService(tx);

  const link = await service.linkPhysicalEntry(
    'visit-a',
    'access-a',
    'gym-a',
    'reception-a',
  );

  assert.equal(visitWhere.member.connection.gymId, 'gym-a');
  assert.equal(eventWhere.gymId, 'gym-a');
  assert.equal(link.accessEventId, 'access-a');
  assert.equal(createdLink.visitAuthorizationId, 'visit-a');
});

test('AGG7 physical link refuses a foreign student even inside same gym', async () => {
  const tx = {
    aggregatorVisitAuthorization: {
      findFirst: async () => ({
        id: 'visit-a',
        status: 'CONFIRMED',
        member: { studentId: 'student-a' },
      }),
    },
    accessEvent: {
      findFirst: async () => ({
        id: 'access-b',
        studentId: 'student-b',
        allowed: true,
        occurredAt: new Date(),
      }),
    },
  };
  const { service } = makeReconciliationService(tx);

  await assert.rejects(
    () =>
      service.linkPhysicalEntry(
        'visit-a',
        'access-b',
        'gym-a',
        'reception-a',
      ),
    /Identidade do evento fisico nao corresponde/,
  );
});

test('AGG7 deterministic 3-way matrix distinguishes reconciliation, missing facts, unpaid and divergence', () => {
  const { classifyThreeWayReconciliation } = require(
    '../dist/src/modules/aggregator/reconciliation/aggregator-reconciliation.service.js'
  );

  const base = {
    authorizationStatus: 'CONFIRMED',
    physicalLinked: true,
    physicalAllowed: true,
    settlementCount: 1,
    settlement: receivedSettlement(),
  };

  assert.equal(classifyThreeWayReconciliation(base), 'RECONCILED');
  assert.equal(
    classifyThreeWayReconciliation({ ...base, settlementCount: 0, settlement: null }),
    'MISSING_PROVIDER_CHECKIN',
  );
  assert.equal(
    classifyThreeWayReconciliation({ ...base, physicalLinked: false }),
    'MISSING_PHYSICAL_ENTRY',
  );
  assert.equal(
    classifyThreeWayReconciliation({
      ...base,
      settlement: receivedSettlement({ status: 'EXPIRED' }),
    }),
    'UNPAID_RISK',
  );
  assert.equal(
    classifyThreeWayReconciliation({
      ...base,
      settlement: receivedSettlement({ amountConfirmed: 2400 }),
    }),
    'AMOUNT_DIVERGENCE',
  );
  assert.equal(
    classifyThreeWayReconciliation({ ...base, settlementCount: 2 }),
    'DUPLICATE',
  );
});

test('AGG7 does not treat provider CONFIRMED as received revenue', () => {
  const { classifyThreeWayReconciliation } = require(
    '../dist/src/modules/aggregator/reconciliation/aggregator-reconciliation.service.js'
  );
  const status = classifyThreeWayReconciliation({
    authorizationStatus: 'CONFIRMED',
    physicalLinked: true,
    physicalAllowed: true,
    settlementCount: 1,
    settlement: receivedSettlement({ status: 'CONFIRMED' }),
  });
  assert.equal(status, 'PENDING');
});

test('AGG7 reconcileVisit persists a canonical RECONCILED snapshot and resolves stale risks', async () => {
  let reconciliationData;
  let resolvedWhere;
  const tx = {
    aggregatorVisitAuthorization: {
      findFirst: async () => reconciliableVisit(),
    },
    aggregatorReconciliation: {
      findMany: async () => [],
      create: async ({ data }) => {
        reconciliationData = data;
        return { id: 'reconciliation-a', createdAt: new Date(), updatedAt: new Date(), ...data };
      },
    },
    aggregatorRiskCase: {
      updateMany: async ({ where }) => {
        resolvedWhere = where;
        return { count: 1 };
      },
    },
  };
  const { service, audits } = makeReconciliationService(tx);

  const result = await service.reconcileVisit('visit-a', 'gym-a', 'manager-a');

  assert.equal(reconciliationData.status, 'RECONCILED');
  assert.equal(reconciliationData.accessEventLinkId, 'link-a');
  assert.equal(reconciliationData.settlementId, 'settlement-a');
  assert.ok(reconciliationData.reconciledAt instanceof Date);
  assert.equal(result.risk, null);
  assert.equal(resolvedWhere.visitAuthorizationId, 'visit-a');
  assert.ok(
    audits.some(
      (audit) => audit.action === 'AGGREGATOR_THREE_WAY_RECONCILIATION_RUN',
    ),
  );
});

test('AGG7 missing provider record opens a deduplicated risk case without inventing amount', async () => {
  let riskData;
  const tx = {
    aggregatorVisitAuthorization: {
      findFirst: async () => reconciliableVisit({ settlements: [] }),
    },
    aggregatorReconciliation: {
      findMany: async () => [],
      create: async ({ data }) => ({
        id: 'reconciliation-missing-provider',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }),
    },
    aggregatorRiskCase: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
      create: async ({ data }) => {
        riskData = data;
        return { id: 'risk-a', createdAt: new Date(), updatedAt: new Date(), resolvedAt: null, ...data };
      },
    },
  };
  const { service } = makeReconciliationService(tx);

  const result = await service.reconcileVisit('visit-a', 'gym-a', 'manager-a');

  assert.equal(result.reconciliation.status, 'MISSING_PROVIDER_CHECKIN');
  assert.equal(riskData.type, 'MISSING_PROVIDER_CHECKIN');
  assert.equal(riskData.potentialAmount, null);
  assert.equal(result.risk.status, 'OPEN');
});

test('AGG7 orphan settlement becomes MANUAL_REVIEW + ORPHAN_SETTLEMENT risk', async () => {
  const orphan = {
    id: 'settlement-orphan',
    connectionId: 'connection-a',
    visitAuthorizationId: null,
    externalSettlementId: 'provider-settlement-orphan',
    externalVisitId: 'provider-visit-unknown',
    status: 'RECEIVED',
    amountExpected: 1800,
    amountConfirmed: 1800,
    currency: 'BRL',
  };
  const tx = {
    aggregatorSettlement: { findFirst: async () => orphan },
    aggregatorReconciliation: {
      findFirst: async () => null,
      create: async ({ data }) => ({ id: 'reconciliation-orphan', createdAt: new Date(), updatedAt: new Date(), ...data }),
    },
    aggregatorRiskCase: {
      findFirst: async () => null,
      create: async ({ data }) => ({ id: 'risk-orphan', createdAt: new Date(), updatedAt: new Date(), resolvedAt: null, ...data }),
    },
  };
  const { service } = makeReconciliationService(tx, {
    aggregatorSettlement: {
      findFirst: async () => ({ id: orphan.id, visitAuthorizationId: null }),
    },
  });

  const result = await service.reconcileSettlement(
    'settlement-orphan',
    'gym-a',
    'manager-a',
  );

  assert.equal(result.reconciliation.status, 'MANUAL_REVIEW');
  assert.equal(result.risk.type, 'ORPHAN_SETTLEMENT');
  assert.equal(result.risk.potentialAmount, 1800);
});

test('AGG7 stays provider-neutral and never creates physical AccessEvent or changes eligibility', async () => {
  const settlement = await source(
    'src/modules/aggregator/settlements/aggregator-settlement-ledger.service.ts',
  );
  const reconciliation = await source(
    'src/modules/aggregator/reconciliation/aggregator-reconciliation.service.ts',
  );

  for (const forbidden of [
    'https://',
    'http://',
    'accessEvent.create',
    'aggregatorEligibilityCheck.create',
    'WELLHUB_PARTNER_TRANSPORT',
    'TOTALPASS_PARTNER_TRANSPORT',
    'webhookSecret',
    'accessToken',
  ]) {
    assert.equal(settlement.includes(forbidden), false, forbidden);
    assert.equal(reconciliation.includes(forbidden), false, forbidden);
  }
  assert.equal(settlement.includes('TransactionIsolationLevel.Serializable'), true);
  assert.equal(reconciliation.includes('TransactionIsolationLevel.Serializable'), true);
});
