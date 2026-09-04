import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SCHEMA = 'prisma/schema.prisma';
const MIGRATION = 'prisma/migrations/20260904204800_canonical_aggregator_domain/migration.sql';

async function read(path) {
  return readFile(path, 'utf8');
}

test('AGG1 creates the complete provider-neutral canonical entity set', async () => {
  const schema = await read(SCHEMA);

  const models = [
    'AggregatorProviderConnection',
    'AggregatorMember',
    'AggregatorMembership',
    'AggregatorAgreement',
    'AggregatorEligibilityCheck',
    'AggregatorVisitAuthorization',
    'AggregatorAccessEventLink',
    'AggregatorProvisionalDecision',
    'AggregatorRevalidationAttempt',
    'AggregatorSettlement',
    'AggregatorReconciliation',
    'AggregatorRiskCase',
  ];

  for (const model of models) {
    assert.equal(schema.includes(`model ${model} {`), true, `missing ${model}`);
  }

  for (const providerSpecificModel of [
    'model Wellhub',
    'model TotalPass',
    'model ClassPass',
  ]) {
    assert.equal(schema.includes(providerSpecificModel), false, `provider-specific core leak: ${providerSpecificModel}`);
  }
});

test('AGG1 physically scopes provider/member external identities', async () => {
  const schema = await read(SCHEMA);

  assert.equal(schema.includes('@@unique([gymId, providerCode])'), true);
  assert.equal(schema.includes('@@unique([connectionId, externalMemberId])'), true);
  assert.equal(schema.includes('@@unique([memberId, externalVisitId])'), true);
  assert.equal(schema.includes('@@unique([connectionId, externalSettlementId])'), true);
});

test('AGG1 keeps UNKNOWN distinct from ELIGIBLE and preserves traceable state machines', async () => {
  const schema = await read(SCHEMA);

  assert.match(
    schema,
    /enum AggregatorEligibilityStatus \{[\s\S]*?UNKNOWN[\s\S]*?ELIGIBLE[\s\S]*?INELIGIBLE[\s\S]*?\}/,
  );
  assert.match(
    schema,
    /enum AggregatorVisitStatus \{[\s\S]*?PENDING[\s\S]*?CONFIRMED[\s\S]*?DENIED[\s\S]*?PROVISIONAL[\s\S]*?FAILED[\s\S]*?\}/,
  );
  assert.match(
    schema,
    /enum AggregatorSettlementStatus \{[\s\S]*?EXPECTED[\s\S]*?CONFIRMED[\s\S]*?RECEIVED[\s\S]*?DIVERGENT[\s\S]*?DISPUTED[\s\S]*?EXPIRED[\s\S]*?\}/,
  );
});

test('AGG1 stores provenance and provider timestamps instead of trusting historical membership alone', async () => {
  const schema = await read(SCHEMA);

  const requiredSignals = [
    'externalMemberId String',
    'externalCheckId',
    'verifiedAt',
    'validUntil',
    'externalVisitId',
    'requestedAt',
    'authorizedAt',
    'provenance',
  ];

  for (const signal of requiredSignals) {
    assert.equal(schema.includes(signal), true, `missing traceability signal ${signal}`);
  }
});

test('AGG1 links physical entry separately from authorization and settlement', async () => {
  const schema = await read(SCHEMA);

  assert.equal(schema.includes('model AggregatorAccessEventLink {'), true);
  assert.equal(schema.includes('accessEventId        String'), true);
  assert.equal(schema.includes('visitAuthorizationId String'), true);
  assert.equal(schema.includes('model AggregatorSettlement {'), true);
  assert.equal(schema.includes('model AggregatorReconciliation {'), true);
});

test('AGG1 migration is explicit and creates the canonical domain with foreign keys', async () => {
  const migration = await read(MIGRATION);

  for (const table of [
    'AggregatorProviderConnection',
    'AggregatorMember',
    'AggregatorEligibilityCheck',
    'AggregatorVisitAuthorization',
    'AggregatorAccessEventLink',
    'AggregatorSettlement',
    'AggregatorReconciliation',
    'AggregatorRiskCase',
  ]) {
    assert.equal(migration.includes(`CREATE TABLE "${table}"`), true, `migration missing ${table}`);
  }

  assert.equal(migration.includes('REFERENCES "Gym"("id")'), true);
  assert.equal(migration.includes('REFERENCES "AccessEvent"("id")'), true);
  assert.equal(migration.includes('REFERENCES "AggregatorVisitAuthorization"("id")'), true);
});
