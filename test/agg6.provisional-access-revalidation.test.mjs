import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

function policyConfiguration(overrides = {}) {
  return {
    provisionalAccessPolicy: {
      enabled: true,
      version: 'gym-policy-v1',
      maxDurationMinutes: 15,
      eligibilityLookbackMinutes: 1440,
      maxRevalidationAttempts: 3,
      ...overrides,
    },
  };
}

function deniedAuthorization(overrides = {}) {
  return {
    id: 'visit-a',
    memberId: 'member-a',
    agreementId: 'agreement-a',
    eligibilityCheckId: 'unknown-a',
    externalVisitId: 'external-visit-a',
    status: 'DENIED',
    authorizedAt: null,
    expiresAt: null,
    denialReason: 'ELIGIBILITY_UNKNOWN',
    provenance: { source: 'TOTALPASS_ADAPTER' },
    member: {
      connection: {
        status: 'ACTIVE',
        configuration: policyConfiguration(),
      },
    },
    agreement: { status: 'SIGNED', signedAt: new Date(Date.now() - 3600_000) },
    provisionalDecision: null,
    ...overrides,
  };
}

function provisionalAuthorization(overrides = {}) {
  return {
    id: 'visit-a',
    memberId: 'member-a',
    status: 'PROVISIONAL',
    authorizedAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 10 * 60_000),
    denialReason: null,
    provenance: { provisionalDecisionVersion: 'AGG6_V1' },
    provisionalDecision: {
      id: 'decision-a',
      visitAuthorizationId: 'visit-a',
      status: 'APPROVED',
      policyVersion: 'gym-policy-v1',
      reason: 'TRANSIENT_PROVIDER_FAILURE_WITH_RECENT_ELIGIBILITY',
      authorizedByUserId: 'operator-a',
      expiresAt: new Date(Date.now() + 10 * 60_000),
      metadata: { maxRevalidationAttempts: 3 },
      createdAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 60_000),
    },
    ...overrides,
  };
}

function makeService(tx) {
  const { AggregatorProvisionalAccessService } = require(
    '../dist/src/modules/aggregator/provisional/aggregator-provisional-access.service.js'
  );
  const audits = [];
  const service = new AggregatorProvisionalAccessService(
    {
      $transaction: async (callback, options) => {
        assert.equal(options.isolationLevel, 'Serializable');
        return callback(tx);
      },
    },
    {
      record: async (input) => {
        audits.push(input);
      },
    },
  );
  return { service, audits };
}

test('AGG6 policy is explicit, versioned and fail-closed when absent or invalid', () => {
  const { parseProvisionalAccessPolicy } = require(
    '../dist/src/modules/aggregator/provisional/aggregator-provisional-access.service.js'
  );

  assert.equal(parseProvisionalAccessPolicy(null).state, 'DISABLED');
  assert.equal(
    parseProvisionalAccessPolicy(policyConfiguration({ maxDurationMinutes: 0 })).state,
    'INVALID',
  );
  const enabled = parseProvisionalAccessPolicy(policyConfiguration());
  assert.equal(enabled.state, 'ENABLED');
  assert.equal(enabled.version, 'gym-policy-v1');
  assert.equal(enabled.maxDurationMinutes, 15);
});

test('AGG6 approves provisional state only for transient provider failure with recent ELIGIBLE evidence', async () => {
  let authorizationWhere;
  let authorizationUpdate;
  let accessEventWrites = 0;
  const latestUnknown = {
    id: 'unknown-a',
    status: 'UNKNOWN',
    reasonCode: 'TOTALPASS_TRANSPORT_UNAVAILABLE',
    verifiedAt: new Date(Date.now() - 30_000),
    validUntil: null,
    createdAt: new Date(Date.now() - 30_000),
  };
  const priorEligible = {
    id: 'eligible-a',
    verifiedAt: new Date(Date.now() - 30 * 60_000),
    validUntil: new Date(Date.now() - 20 * 60_000),
  };

  const tx = {
    aggregatorVisitAuthorization: {
      findFirst: async ({ where }) => {
        authorizationWhere = where;
        return deniedAuthorization();
      },
      update: async ({ data }) => {
        authorizationUpdate = data;
        return { ...deniedAuthorization(), ...data };
      },
    },
    aggregatorEligibilityCheck: {
      findFirst: async ({ where }) =>
        where.status === 'ELIGIBLE' ? priorEligible : latestUnknown,
    },
    aggregatorProvisionalDecision: {
      create: async ({ data }) => ({
        id: 'decision-a',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }),
    },
    accessEvent: {
      create: async () => {
        accessEventWrites += 1;
      },
    },
  };

  const { service, audits } = makeService(tx);
  const decision = await service.requestProvisionalAccess(
    'visit-a',
    'gym-a',
    'operator-a',
  );

  assert.equal(authorizationWhere.member.connection.gymId, 'gym-a');
  assert.equal(decision.status, 'APPROVED');
  assert.equal(decision.policyVersion, 'gym-policy-v1');
  assert.equal(authorizationUpdate.status, 'PROVISIONAL');
  assert.equal(authorizationUpdate.denialReason, null);
  assert.equal(accessEventWrites, 0);
  assert.ok(audits.some((audit) => audit.action === 'AGGREGATOR_PROVISIONAL_ACCESS_APPROVED'));
  assert.ok(audits.some((audit) => audit.action === 'AGGREGATOR_VISIT_MARKED_PROVISIONAL'));
});

test('AGG6 refuses provisional access for non-transient UNKNOWN such as missing homologation', async () => {
  let authorizationUpdates = 0;
  const tx = {
    aggregatorVisitAuthorization: {
      findFirst: async () => deniedAuthorization(),
      update: async () => {
        authorizationUpdates += 1;
      },
    },
    aggregatorEligibilityCheck: {
      findFirst: async () => ({
        id: 'unknown-a',
        status: 'UNKNOWN',
        reasonCode: 'TOTALPASS_NOT_HOMOLOGATED',
        verifiedAt: new Date(),
        validUntil: null,
        createdAt: new Date(),
      }),
    },
    aggregatorProvisionalDecision: {
      create: async ({ data }) => ({ id: 'decision-denied', ...data }),
    },
  };
  const { service } = makeService(tx);

  const decision = await service.requestProvisionalAccess(
    'visit-a',
    'gym-a',
    'operator-a',
  );

  assert.equal(decision.status, 'DENIED');
  assert.equal(
    decision.reason,
    'PROVISIONAL_UNKNOWN_NOT_TRANSIENT_PROVIDER_FAILURE',
  );
  assert.equal(authorizationUpdates, 0);
});

test('AGG6 rejects cross-tenant provisional target before reading policy or evidence', async () => {
  let whereSeen;
  const tx = {
    aggregatorVisitAuthorization: {
      findFirst: async ({ where }) => {
        whereSeen = where;
        return null;
      },
    },
  };
  const { service } = makeService(tx);

  await assert.rejects(
    () => service.requestProvisionalAccess('visit-b', 'gym-a', 'operator-a'),
    (error) => {
      assert.equal(error.getStatus(), 404);
      return true;
    },
  );
  assert.equal(whereSeen.member.connection.gymId, 'gym-a');
});

test('AGG6 revalidation promotes PROVISIONAL to CONFIRMED only with fresh live ELIGIBLE evidence', async () => {
  const updates = [];
  const freshEligible = {
    id: 'eligible-fresh',
    externalCheckId: 'provider-check-fresh',
    status: 'ELIGIBLE',
    reasonCode: null,
    verifiedAt: new Date(Date.now() - 5_000),
    validUntil: new Date(Date.now() + 10 * 60_000),
    createdAt: new Date(),
  };
  const tx = {
    aggregatorVisitAuthorization: {
      findFirst: async () => provisionalAuthorization(),
      update: async ({ data }) => {
        updates.push(data);
        return { ...provisionalAuthorization(), ...data };
      },
    },
    aggregatorRevalidationAttempt: {
      count: async () => 0,
      create: async ({ data }) => ({ id: 'attempt-a', ...data }),
    },
    aggregatorEligibilityCheck: { findFirst: async () => freshEligible },
    aggregatorProvisionalDecision: { update: async () => assert.fail('must not revoke') },
  };
  const { service, audits } = makeService(tx);

  const result = await service.revalidate('visit-a', 'gym-a', 'worker-a');

  assert.equal(result.attempt.status, 'CONFIRMED');
  assert.equal(result.authorization.status, 'CONFIRMED');
  assert.equal(updates[0].eligibilityCheckId, 'eligible-fresh');
  assert.ok(
    audits.some(
      (audit) => audit.action === 'AGGREGATOR_PROVISIONAL_REVALIDATION_CONFIRMED',
    ),
  );
});

test('AGG6 fresh INELIGIBLE revalidation revokes provisional decision and marks visit FAILED', async () => {
  const freshIneligible = {
    id: 'ineligible-fresh',
    externalCheckId: 'provider-check-b',
    status: 'INELIGIBLE',
    reasonCode: 'MEMBERSHIP_INACTIVE',
    verifiedAt: new Date(Date.now() - 5_000),
    validUntil: null,
    createdAt: new Date(),
  };
  const tx = {
    aggregatorVisitAuthorization: {
      findFirst: async () => provisionalAuthorization(),
      update: async ({ data }) => ({ ...provisionalAuthorization(), ...data }),
    },
    aggregatorRevalidationAttempt: {
      count: async () => 0,
      create: async ({ data }) => ({ id: 'attempt-b', ...data }),
    },
    aggregatorEligibilityCheck: { findFirst: async () => freshIneligible },
    aggregatorProvisionalDecision: {
      update: async ({ data }) => ({
        ...provisionalAuthorization().provisionalDecision,
        ...data,
      }),
    },
  };
  const { service } = makeService(tx);

  const result = await service.revalidate('visit-a', 'gym-a', 'worker-a');

  assert.equal(result.attempt.status, 'FAILED');
  assert.equal(result.decision.status, 'REVOKED');
  assert.equal(result.authorization.status, 'FAILED');
  assert.equal(result.authorization.denialReason, 'REVALIDATION_INELIGIBLE');
});

test('AGG6 repeated UNKNOWN revalidation expires provisional access at snapshotted attempt limit', async () => {
  const base = provisionalAuthorization({
    provisionalDecision: {
      ...provisionalAuthorization().provisionalDecision,
      metadata: { maxRevalidationAttempts: 1 },
    },
  });
  const tx = {
    aggregatorVisitAuthorization: {
      findFirst: async () => base,
      update: async ({ data }) => ({ ...base, ...data }),
    },
    aggregatorRevalidationAttempt: {
      count: async () => 0,
      create: async ({ data }) => ({ id: 'attempt-unknown', ...data }),
    },
    aggregatorEligibilityCheck: { findFirst: async () => null },
    aggregatorProvisionalDecision: {
      update: async ({ data }) => ({ ...base.provisionalDecision, ...data }),
    },
  };
  const { service } = makeService(tx);

  const result = await service.revalidate('visit-a', 'gym-a');

  assert.equal(result.attempt.status, 'UNKNOWN');
  assert.equal(result.attempt.reasonCode, 'NO_FRESH_REVALIDATION_EVIDENCE');
  assert.equal(result.decision.status, 'EXPIRED');
  assert.equal(result.authorization.status, 'FAILED');
  assert.equal(
    result.authorization.denialReason,
    'REVALIDATION_ATTEMPTS_EXHAUSTED',
  );
});

test('AGG6 remains provider-neutral and outside physical AccessEvent and settlement execution', async () => {
  const service = await source(
    'src/modules/aggregator/provisional/aggregator-provisional-access.service.ts',
  );
  const controller = await source(
    'src/modules/aggregator/provisional/aggregator-provisional-access.controller.ts',
  );

  assert.equal(service.includes('accessEvent.create'), false);
  assert.equal(service.includes('aggregatorAccessEventLink'), false);
  assert.equal(service.includes('aggregatorSettlement'), false);
  assert.equal(service.includes('WELLHUB'), false);
  assert.equal(service.includes('TOTALPASS'), false);
  assert.equal(service.includes('TransactionIsolationLevel.Serializable'), true);
  assert.equal(controller.includes("@Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION')"), true);
  assert.equal(controller.includes('gymId)'), false);
});
