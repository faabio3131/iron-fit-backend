import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

function activeMember(overrides = {}) {
  return {
    id: 'member-a',
    externalMemberId: 'wellhub-member-a',
    connection: {
      id: 'connection-a',
      status: 'ACTIVE',
      externalLocationId: 'wellhub-location-a',
      contractVersion: 'partner-contract-v1',
      lastVerifiedAt: new Date('2026-09-04T20:00:00.000Z'),
      ...overrides,
    },
  };
}

test('AGG4 Wellhub adapter has no invented endpoint, webhook, secret or physical-access implementation', async () => {
  const adapter = await source(
    'src/modules/aggregator/providers/wellhub/wellhub-adapter.service.ts',
  );
  const transport = await source(
    'src/modules/aggregator/providers/wellhub/wellhub-partner-transport.ts',
  );

  for (const forbidden of [
    'https://',
    'http://',
    'webhookSecret',
    'apiKey',
    'accessToken',
    'accessEvent.create',
    'aggregatorAccessEventLink',
    'aggregatorSettlement',
  ]) {
    assert.equal(adapter.includes(forbidden), false, forbidden);
    assert.equal(transport.includes(forbidden), false, forbidden);
  }
  assert.equal(transport.includes('fetchCurrentEligibility'), true);
  assert.equal(adapter.includes("const WELLHUB_PROVIDER_CODE = 'WELLHUB'"), true);
});

test('AGG4 scopes member to Wellhub and active tenant before any provider call', async () => {
  const {
    WellhubAdapterService,
  } = require('../dist/src/modules/aggregator/providers/wellhub/wellhub-adapter.service.js');

  let memberWhere;
  let transportCalls = 0;
  const prisma = {
    aggregatorMember: {
      findFirst: async ({ where }) => {
        memberWhere = where;
        return null;
      },
    },
  };
  const service = new WellhubAdapterService(
    prisma,
    { recordProviderEvidence: async () => undefined },
    { authorize: async () => undefined },
    {
      fetchCurrentEligibility: async () => {
        transportCalls += 1;
      },
    },
  );

  await assert.rejects(
    () =>
      service.refreshEligibilityAndAuthorize(
        { memberId: 'member-b', externalVisitId: 'visit-b' },
        'gym-a',
        'operator-a',
      ),
    (error) => {
      assert.equal(error.getStatus(), 404);
      return true;
    },
  );

  assert.equal(memberWhere.id, 'member-b');
  assert.equal(memberWhere.connection.gymId, 'gym-a');
  assert.equal(memberWhere.connection.providerCode, 'WELLHUB');
  assert.equal(transportCalls, 0);
});

test('AGG4 returns an existing visit decision before consuming Wellhub transport again', async () => {
  const {
    WellhubAdapterService,
  } = require('../dist/src/modules/aggregator/providers/wellhub/wellhub-adapter.service.js');

  let transportCalls = 0;
  let eligibilityWrites = 0;
  const existing = { id: 'authorization-a', status: 'CONFIRMED' };
  const service = new WellhubAdapterService(
    {
      aggregatorMember: { findFirst: async () => activeMember() },
      aggregatorVisitAuthorization: { findUnique: async () => existing },
    },
    {
      recordProviderEvidence: async () => {
        eligibilityWrites += 1;
      },
    },
    { authorize: async () => undefined },
    {
      fetchCurrentEligibility: async () => {
        transportCalls += 1;
      },
    },
  );

  const result = await service.refreshEligibilityAndAuthorize(
    { memberId: 'member-a', externalVisitId: 'visit-a' },
    'gym-a',
    'operator-a',
  );

  assert.equal(result, existing);
  assert.equal(transportCalls, 0);
  assert.equal(eligibilityWrites, 0);
});

test('AGG4 inactive connection never calls Wellhub and delegates deterministic denial to AGG3', async () => {
  const {
    WellhubAdapterService,
  } = require('../dist/src/modules/aggregator/providers/wellhub/wellhub-adapter.service.js');

  let transportCalls = 0;
  let eligibilityWrites = 0;
  let authorizeArgs;
  const service = new WellhubAdapterService(
    {
      aggregatorMember: {
        findFirst: async () => activeMember({ status: 'SUSPENDED' }),
      },
      aggregatorVisitAuthorization: { findUnique: async () => null },
    },
    {
      recordProviderEvidence: async () => {
        eligibilityWrites += 1;
      },
    },
    {
      authorize: async (...args) => {
        authorizeArgs = args;
        return { status: 'DENIED', denialReason: 'PROVIDER_CONNECTION_NOT_ACTIVE' };
      },
    },
    {
      fetchCurrentEligibility: async () => {
        transportCalls += 1;
      },
    },
  );

  const result = await service.refreshEligibilityAndAuthorize(
    { memberId: 'member-a', externalVisitId: 'visit-a' },
    'gym-a',
    'operator-a',
  );

  assert.equal(result.status, 'DENIED');
  assert.equal(transportCalls, 0);
  assert.equal(eligibilityWrites, 0);
  assert.equal(authorizeArgs[1], 'gym-a');
  assert.equal(authorizeArgs[3], 'WELLHUB_ADAPTER');
});

test('AGG4 non-homologated or unavailable transport records fresh UNKNOWN before authorization', async () => {
  const {
    WellhubAdapterService,
  } = require('../dist/src/modules/aggregator/providers/wellhub/wellhub-adapter.service.js');

  const reasons = [];
  const makeService = (member, transport) =>
    new WellhubAdapterService(
      {
        aggregatorMember: { findFirst: async () => member },
        aggregatorVisitAuthorization: { findUnique: async () => null },
      },
      {
        recordProviderEvidence: async (input) => {
          reasons.push({ status: input.status, reasonCode: input.reasonCode });
        },
      },
      {
        authorize: async () => ({
          status: 'DENIED',
          denialReason: 'ELIGIBILITY_UNKNOWN',
        }),
      },
      transport,
    );

  const nonHomologated = makeService(
    activeMember({ contractVersion: null }),
    undefined,
  );
  await nonHomologated.refreshEligibilityAndAuthorize(
    { memberId: 'member-a', externalVisitId: 'visit-a' },
    'gym-a',
    'operator-a',
  );

  const unavailable = makeService(activeMember(), undefined);
  await unavailable.refreshEligibilityAndAuthorize(
    { memberId: 'member-a', externalVisitId: 'visit-b' },
    'gym-a',
    'operator-a',
  );

  assert.deepEqual(reasons, [
    { status: 'UNKNOWN', reasonCode: 'WELLHUB_NOT_HOMOLOGATED' },
    { status: 'UNKNOWN', reasonCode: 'WELLHUB_TRANSPORT_UNAVAILABLE' },
  ]);
});

test('AGG4 maps normalized Wellhub evidence into canonical eligibility then invokes AGG3 authorization', async () => {
  const {
    WellhubAdapterService,
  } = require('../dist/src/modules/aggregator/providers/wellhub/wellhub-adapter.service.js');

  const verifiedAt = new Date(Date.now() - 60_000);
  const validUntil = new Date(Date.now() + 10 * 60_000);
  let evidenceWrite;
  let transportRequest;
  let authorizeArgs;
  const service = new WellhubAdapterService(
    {
      aggregatorMember: { findFirst: async () => activeMember() },
      aggregatorVisitAuthorization: { findUnique: async () => null },
      aggregatorMembership: {
        findFirst: async () => ({ id: 'membership-a' }),
      },
    },
    {
      recordProviderEvidence: async (input, gymId, actorUserId) => {
        evidenceWrite = { input, gymId, actorUserId };
      },
    },
    {
      authorize: async (...args) => {
        authorizeArgs = args;
        return { status: 'CONFIRMED' };
      },
    },
    {
      fetchCurrentEligibility: async (request) => {
        transportRequest = request;
        return {
          canonicalStatus: 'ELIGIBLE',
          externalCheckId: 'wellhub-check-a',
          externalMembershipId: 'wellhub-membership-a',
          providerStatus: 'provider-ok',
          verifiedAt,
          validUntil,
          evidenceRef: 'provider-evidence-a',
        };
      },
    },
  );

  const result = await service.refreshEligibilityAndAuthorize(
    { memberId: 'member-a', externalVisitId: 'visit-a' },
    'gym-a',
    'operator-a',
  );

  assert.equal(result.status, 'CONFIRMED');
  assert.equal(transportRequest.externalLocationId, 'wellhub-location-a');
  assert.equal(transportRequest.externalMemberId, 'wellhub-member-a');
  assert.equal(evidenceWrite.input.status, 'ELIGIBLE');
  assert.equal(evidenceWrite.input.membershipId, 'membership-a');
  assert.equal(evidenceWrite.input.source, 'WELLHUB_ADAPTER');
  assert.equal(evidenceWrite.gymId, 'gym-a');
  assert.equal(authorizeArgs[3], 'WELLHUB_ADAPTER');
});

test('AGG4 never invents eligibility TTL: provider ELIGIBLE without valid expiry is downgraded to UNKNOWN', async () => {
  const {
    WellhubAdapterService,
  } = require('../dist/src/modules/aggregator/providers/wellhub/wellhub-adapter.service.js');

  let evidenceWrite;
  const service = new WellhubAdapterService(
    {
      aggregatorMember: { findFirst: async () => activeMember() },
      aggregatorVisitAuthorization: { findUnique: async () => null },
      aggregatorMembership: { findFirst: async () => null },
    },
    {
      recordProviderEvidence: async (input) => {
        evidenceWrite = input;
      },
    },
    {
      authorize: async () => ({
        status: 'DENIED',
        denialReason: 'ELIGIBILITY_UNKNOWN',
      }),
    },
    {
      fetchCurrentEligibility: async () => ({
        canonicalStatus: 'ELIGIBLE',
        externalCheckId: 'wellhub-check-no-expiry',
        verifiedAt: new Date(Date.now() - 60_000),
      }),
    },
  );

  const result = await service.refreshEligibilityAndAuthorize(
    { memberId: 'member-a', externalVisitId: 'visit-no-expiry' },
    'gym-a',
    'operator-a',
  );

  assert.equal(evidenceWrite.status, 'UNKNOWN');
  assert.equal(
    evidenceWrite.reasonCode,
    'WELLHUB_ELIGIBLE_WITHOUT_VALID_EXPIRY',
  );
  assert.equal(evidenceWrite.validUntil, undefined);
  assert.equal(result.status, 'DENIED');
});
