import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

test('AGG3 API derives tenant from authenticated context and does not accept gymId/source as visit authority', async () => {
  const controller = await source(
    'src/modules/aggregator/visits/aggregator-visit-authorization.controller.ts',
  );
  const dto = await source(
    'src/modules/aggregator/visits/dto/authorize-aggregator-visit.dto.ts',
  );

  assert.equal(controller.includes('user.activeGymId ?? user.gymId'), true);
  assert.equal(controller.includes("@Post('authorize')"), true);
  assert.equal(dto.includes('gymId'), false);
  assert.equal(dto.includes('source'), false);
});

test('AGG3 eligibility engine converts stale or incomplete ELIGIBLE evidence back to UNKNOWN', () => {
  const {
    evaluateEligibilityEvidence,
  } = require('../dist/src/modules/aggregator/eligibility/aggregator-eligibility.service.js');

  const at = new Date('2026-09-04T20:00:00.000Z');
  const expired = evaluateEligibilityEvidence(
    {
      id: 'check-expired',
      status: 'ELIGIBLE',
      verifiedAt: new Date('2026-09-04T18:00:00.000Z'),
      validUntil: new Date('2026-09-04T19:00:00.000Z'),
      reasonCode: null,
    },
    at,
  );
  assert.equal(expired.status, 'UNKNOWN');
  assert.equal(expired.reasonCode, 'ELIGIBILITY_EXPIRED');

  const missingExpiry = evaluateEligibilityEvidence(
    {
      id: 'check-no-expiry',
      status: 'ELIGIBLE',
      verifiedAt: new Date('2026-09-04T18:00:00.000Z'),
      validUntil: null,
      reasonCode: null,
    },
    at,
  );
  assert.equal(missingExpiry.status, 'UNKNOWN');
  assert.equal(missingExpiry.reasonCode, 'ELIGIBILITY_MISSING_EXPIRY');
});

test('AGG3 visit authorization confirms only with active connection, signed agreement and live ELIGIBLE evidence', async () => {
  const {
    AggregatorVisitAuthorizationService,
  } = require('../dist/src/modules/aggregator/visits/aggregator-visit-authorization.service.js');

  let auditCalls = 0;
  const tx = {
    aggregatorMember: {
      findFirst: async () => ({
        id: 'member-a',
        connection: { id: 'conn-a', status: 'ACTIVE' },
      }),
    },
    aggregatorVisitAuthorization: {
      findUnique: async () => null,
      create: async ({ data }) => ({
        id: 'authorization-a',
        requestedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }),
    },
    aggregatorAgreement: {
      findFirst: async () => ({
        id: 'agreement-a',
        status: 'SIGNED',
        signedAt: new Date(Date.now() - 60_000),
      }),
    },
    aggregatorEligibilityCheck: {
      findFirst: async () => ({
        id: 'check-a',
        status: 'ELIGIBLE',
        verifiedAt: new Date(Date.now() - 60_000),
        validUntil: new Date(Date.now() + 10 * 60_000),
        reasonCode: null,
      }),
    },
  };

  const prisma = {
    $transaction: async (operation) => operation(tx),
  };
  const audit = {
    record: async () => {
      auditCalls += 1;
    },
  };
  const service = new AggregatorVisitAuthorizationService(prisma, audit);
  const result = await service.authorize(
    { memberId: 'member-a', externalVisitId: 'external-visit-a' },
    'gym-a',
    'operator-a',
  );

  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.agreementId, 'agreement-a');
  assert.equal(result.eligibilityCheckId, 'check-a');
  assert.equal(result.denialReason, null);
  assert.equal(result.authorizedAt instanceof Date, true);
  assert.equal(result.expiresAt instanceof Date, true);
  assert.equal(auditCalls, 1);
});

test('AGG3 UNKNOWN eligibility is a durable denial, never an implicit authorization', async () => {
  const {
    AggregatorVisitAuthorizationService,
  } = require('../dist/src/modules/aggregator/visits/aggregator-visit-authorization.service.js');

  let persisted = null;
  const tx = {
    aggregatorMember: {
      findFirst: async () => ({
        id: 'member-a',
        connection: { id: 'conn-a', status: 'ACTIVE' },
      }),
    },
    aggregatorVisitAuthorization: {
      findUnique: async () => null,
      create: async ({ data }) => {
        persisted = data;
        return {
          id: 'authorization-denied',
          requestedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
      },
    },
    aggregatorAgreement: {
      findFirst: async () => ({
        id: 'agreement-a',
        status: 'SIGNED',
        signedAt: new Date(Date.now() - 60_000),
      }),
    },
    aggregatorEligibilityCheck: {
      findFirst: async () => null,
    },
  };

  const service = new AggregatorVisitAuthorizationService(
    { $transaction: async (operation) => operation(tx) },
    { record: async () => undefined },
  );
  const result = await service.authorize(
    { memberId: 'member-a', externalVisitId: 'external-visit-unknown' },
    'gym-a',
    'operator-a',
  );

  assert.equal(result.status, 'DENIED');
  assert.equal(result.denialReason, 'ELIGIBILITY_UNKNOWN');
  assert.equal(result.authorizedAt, null);
  assert.equal(result.expiresAt, null);
  assert.equal(persisted.status, 'DENIED');
});

test('AGG3 rejects a member outside the active tenant before creating an authorization', async () => {
  const {
    AggregatorVisitAuthorizationService,
  } = require('../dist/src/modules/aggregator/visits/aggregator-visit-authorization.service.js');

  let creates = 0;
  const tx = {
    aggregatorMember: { findFirst: async () => null },
    aggregatorVisitAuthorization: {
      findUnique: async () => null,
      create: async () => {
        creates += 1;
      },
    },
  };
  const service = new AggregatorVisitAuthorizationService(
    { $transaction: async (operation) => operation(tx) },
    { record: async () => undefined },
  );

  await assert.rejects(
    () =>
      service.authorize(
        { memberId: 'member-b', externalVisitId: 'external-visit-b' },
        'gym-a',
        'operator-a',
      ),
    (error) => {
      assert.equal(error.getStatus(), 404);
      return true;
    },
  );
  assert.equal(creates, 0);
});

test('AGG3 remains outside physical access, provisional access and settlement execution', async () => {
  const visits = await source(
    'src/modules/aggregator/visits/aggregator-visit-authorization.service.ts',
  );
  assert.equal(visits.includes('aggregatorAccessEventLink'), false);
  assert.equal(visits.includes('accessEvent.create'), false);
  assert.equal(visits.includes('AggregatorVisitStatus.PROVISIONAL'), false);
  assert.equal(visits.includes('aggregatorSettlement'), false);
});

test('AGG3 eligibility evidence is internal provider-neutral input and uses Serializable atomic audit', async () => {
  const eligibility = await source(
    'src/modules/aggregator/eligibility/aggregator-eligibility.service.ts',
  );
  const controller = await source(
    'src/modules/aggregator/eligibility/aggregator-eligibility.controller.ts',
  );

  assert.equal(eligibility.includes('recordProviderEvidence'), true);
  assert.equal(eligibility.includes('TransactionIsolationLevel.Serializable'), true);
  assert.equal(
    eligibility.includes("action: 'AGGREGATOR_ELIGIBILITY_CHECK_RECORDED'"),
    true,
  );
  assert.equal(controller.includes('recordProviderEvidence'), false);
});
