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
    externalMemberId: 'totalpass-member-a',
    connection: {
      status: 'ACTIVE',
      externalLocationId: 'totalpass-place-a',
      contractVersion: 'partner-contract-v1',
      lastVerifiedAt: new Date('2026-09-04T20:00:00.000Z'),
      ...overrides,
    },
  };
}

test('AGG5 Future Provider Contract classifies every canonical capability explicitly', () => {
  const {
    AGGREGATOR_PROVIDER_CAPABILITIES,
  } = require('../dist/src/modules/aggregator/providers/contracts/future-provider-contract.js');
  const {
    TOTALPASS_PROVIDER_CONTRACT,
  } = require('../dist/src/modules/aggregator/providers/totalpass/totalpass-contract.js');

  assert.equal(TOTALPASS_PROVIDER_CONTRACT.providerCode, 'TOTALPASS');
  assert.equal(TOTALPASS_PROVIDER_CONTRACT.adapterVersion, 'AGG5_V1');
  assert.equal(
    Object.keys(TOTALPASS_PROVIDER_CONTRACT.capabilities).length,
    AGGREGATOR_PROVIDER_CAPABILITIES.length,
  );
  for (const capability of AGGREGATOR_PROVIDER_CAPABILITIES) {
    assert.ok(TOTALPASS_PROVIDER_CONTRACT.capabilities[capability]);
  }
});

test('AGG5 TotalPass contract does not promote unknown external capabilities to supported facts', () => {
  const {
    TOTALPASS_PROVIDER_CONTRACT,
  } = require('../dist/src/modules/aggregator/providers/totalpass/totalpass-contract.js');

  assert.equal(
    TOTALPASS_PROVIDER_CONTRACT.capabilities.CURRENT_VISIT_ELIGIBILITY,
    'PUBLICLY_CONFIRMED',
  );
  assert.equal(
    TOTALPASS_PROVIDER_CONTRACT.capabilities.CHECKIN_EVENT_INBOUND,
    'PUBLICLY_CONFIRMED',
  );
  assert.equal(
    TOTALPASS_PROVIDER_CONTRACT.capabilities.CHECKIN_CONFIRMATION_OUTBOUND,
    'PUBLICLY_CONFIRMED',
  );
  assert.equal(
    TOTALPASS_PROVIDER_CONTRACT.capabilities.SETTLEMENT_API,
    'NOT_PUBLICLY_CONFIRMED',
  );
  assert.equal(
    TOTALPASS_PROVIDER_CONTRACT.capabilities.PROVIDER_HEALTH_SIGNAL,
    'NOT_PUBLICLY_CONFIRMED',
  );
  assert.equal(
    TOTALPASS_PROVIDER_CONTRACT.capabilities.RATE_LIMIT_CONTRACT,
    'PARTNER_ACCESS_REQUIRED',
  );
});

test('AGG5 Future Provider Contract rejects invalid provider identities', () => {
  const {
    defineProviderContract,
    AGGREGATOR_PROVIDER_CAPABILITIES,
  } = require('../dist/src/modules/aggregator/providers/contracts/future-provider-contract.js');

  const capabilities = Object.fromEntries(
    AGGREGATOR_PROVIDER_CAPABILITIES.map((capability) => [
      capability,
      'NOT_PUBLICLY_CONFIRMED',
    ]),
  );

  assert.throws(
    () =>
      defineProviderContract({
        providerCode: 'bad provider',
        adapterVersion: 'v1',
        capabilities,
      }),
    /providerCode canonico invalido/,
  );
});

test('AGG5 adapter contains no invented TotalPass endpoint, credential or physical-access implementation', async () => {
  const adapter = await source(
    'src/modules/aggregator/providers/totalpass/totalpass-adapter.service.ts',
  );
  const transport = await source(
    'src/modules/aggregator/providers/totalpass/totalpass-partner-transport.ts',
  );

  for (const forbidden of [
    'https://',
    'http://',
    'partner_api_key',
    'place_api_key',
    'accessToken',
    'webhookSecret',
    'accessEvent.create',
    'aggregatorAccessEventLink',
    'aggregatorSettlement',
  ]) {
    assert.equal(adapter.includes(forbidden), false, forbidden);
    assert.equal(transport.includes(forbidden), false, forbidden);
  }
  assert.equal(transport.includes('ProviderEligibilityTransport'), true);
});

test('AGG5 scopes member to TotalPass and active tenant before any provider call', async () => {
  const {
    TotalPassAdapterService,
  } = require('../dist/src/modules/aggregator/providers/totalpass/totalpass-adapter.service.js');

  let memberWhere;
  let transportCalls = 0;
  const service = new TotalPassAdapterService(
    {
      aggregatorMember: {
        findFirst: async ({ where }) => {
          memberWhere = where;
          return null;
        },
      },
    },
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

  assert.equal(memberWhere.connection.gymId, 'gym-a');
  assert.equal(memberWhere.connection.providerCode, 'TOTALPASS');
  assert.equal(transportCalls, 0);
});

test('AGG5 existing decision prevents replaying provider transport', async () => {
  const {
    TotalPassAdapterService,
  } = require('../dist/src/modules/aggregator/providers/totalpass/totalpass-adapter.service.js');

  let transportCalls = 0;
  const existing = { id: 'authorization-a', status: 'CONFIRMED' };
  const service = new TotalPassAdapterService(
    {
      aggregatorMember: { findFirst: async () => activeMember() },
      aggregatorVisitAuthorization: { findUnique: async () => existing },
    },
    { recordProviderEvidence: async () => undefined },
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
});

test('AGG5 missing homologation or transport records fresh UNKNOWN before AGG3 decision', async () => {
  const {
    TotalPassAdapterService,
  } = require('../dist/src/modules/aggregator/providers/totalpass/totalpass-adapter.service.js');

  const writes = [];
  const makeService = (member, transport) =>
    new TotalPassAdapterService(
      {
        aggregatorMember: { findFirst: async () => member },
        aggregatorVisitAuthorization: { findUnique: async () => null },
      },
      {
        recordProviderEvidence: async (input) => {
          writes.push({ status: input.status, reasonCode: input.reasonCode });
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

  await makeService(activeMember({ contractVersion: null }), undefined)
    .refreshEligibilityAndAuthorize(
      { memberId: 'member-a', externalVisitId: 'visit-a' },
      'gym-a',
      'operator-a',
    );
  await makeService(activeMember(), undefined).refreshEligibilityAndAuthorize(
    { memberId: 'member-a', externalVisitId: 'visit-b' },
    'gym-a',
    'operator-a',
  );

  assert.deepEqual(writes, [
    { status: 'UNKNOWN', reasonCode: 'TOTALPASS_NOT_HOMOLOGATED' },
    { status: 'UNKNOWN', reasonCode: 'TOTALPASS_TRANSPORT_UNAVAILABLE' },
  ]);
});

test('AGG5 normalized TotalPass evidence flows into canonical eligibility and AGG3 authorization', async () => {
  const {
    TotalPassAdapterService,
  } = require('../dist/src/modules/aggregator/providers/totalpass/totalpass-adapter.service.js');

  const verifiedAt = new Date(Date.now() - 60_000);
  const validUntil = new Date(Date.now() + 10 * 60_000);
  let evidenceWrite;
  let transportRequest;
  let authorizeArgs;
  const service = new TotalPassAdapterService(
    {
      aggregatorMember: { findFirst: async () => activeMember() },
      aggregatorVisitAuthorization: { findUnique: async () => null },
      aggregatorMembership: { findFirst: async () => ({ id: 'membership-a' }) },
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
          externalCheckId: 'totalpass-check-a',
          externalMembershipId: 'totalpass-membership-a',
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
  assert.equal(transportRequest.externalLocationId, 'totalpass-place-a');
  assert.equal(transportRequest.externalMemberId, 'totalpass-member-a');
  assert.equal(evidenceWrite.input.status, 'ELIGIBLE');
  assert.equal(evidenceWrite.input.membershipId, 'membership-a');
  assert.equal(evidenceWrite.input.source, 'TOTALPASS_ADAPTER');
  assert.equal(evidenceWrite.gymId, 'gym-a');
  assert.equal(authorizeArgs[3], 'TOTALPASS_ADAPTER');
});

test('AGG5 does not invent eligibility TTL for TotalPass', async () => {
  const {
    TotalPassAdapterService,
  } = require('../dist/src/modules/aggregator/providers/totalpass/totalpass-adapter.service.js');

  let evidenceWrite;
  const service = new TotalPassAdapterService(
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
        externalCheckId: 'totalpass-check-no-expiry',
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
    'TOTALPASS_ELIGIBLE_WITHOUT_VALID_EXPIRY',
  );
  assert.equal(result.status, 'DENIED');
});
