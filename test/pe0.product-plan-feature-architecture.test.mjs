import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

test('PE0 defines FEATURE, LIMIT and POLICY as the only entitlement value kinds', () => {
  const { ENTITLEMENT_VALUE_KINDS } = require(
    '../dist/src/modules/product-entitlements/contracts/product-entitlement-contract.js',
  );

  assert.deepEqual(ENTITLEMENT_VALUE_KINDS, ['FEATURE', 'LIMIT', 'POLICY']);
});

test('PE0 enforces monotonic precedence from IRON policy to user preference', () => {
  const {
    PRODUCT_CONFIGURATION_PRECEDENCE,
    canNarrowFeature,
    canNarrowLimit,
    canNarrowPolicy,
  } = require(
    '../dist/src/modules/product-entitlements/contracts/product-entitlement-contract.js',
  );

  assert.deepEqual(PRODUCT_CONFIGURATION_PRECEDENCE, [
    'IRON_POLICY',
    'PLAN_ENTITLEMENT',
    'TENANT_CONFIGURATION',
    'USER_PREFERENCE',
  ]);

  assert.equal(canNarrowFeature(false, true), false);
  assert.equal(canNarrowFeature(true, false), true);
  assert.equal(canNarrowFeature(true, true), true);

  assert.equal(canNarrowLimit(100, 101), false);
  assert.equal(canNarrowLimit(100, 50), true);
  assert.equal(canNarrowLimit(100, 100), true);

  assert.equal(canNarrowPolicy(['A', 'B'], ['A']), true);
  assert.equal(canNarrowPolicy(['A'], ['A', 'B']), false);
});

test('PE0 feature catalog is namespaced, unique and fail-closed by kind', () => {
  const {
    PRODUCT_FEATURE_CATALOG_V1,
    assertCanonicalFeatureCatalog,
  } = require(
    '../dist/src/modules/product-entitlements/contracts/product-entitlement-contract.js',
  );

  assert.doesNotThrow(() => assertCanonicalFeatureCatalog(PRODUCT_FEATURE_CATALOG_V1));
  assert.equal(
    new Set(PRODUCT_FEATURE_CATALOG_V1.map((feature) => feature.key)).size,
    PRODUCT_FEATURE_CATALOG_V1.length,
  );

  for (const feature of PRODUCT_FEATURE_CATALOG_V1) {
    assert.match(feature.key, /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
    if (feature.kind === 'FEATURE') assert.equal(feature.failClosedDefault, false);
    if (feature.kind === 'LIMIT') assert.equal(feature.failClosedDefault, 0);
    if (feature.kind === 'POLICY') assert.equal(feature.failClosedDefault, null);
  }
});

test('PE0 keeps SaaS ProductPlan semantically distinct from student financial Subscription', () => {
  const {
    SAAS_PRODUCT_PLAN_DOMAIN,
    STUDENT_FINANCIAL_SUBSCRIPTION_DOMAIN,
  } = require(
    '../dist/src/modules/product-entitlements/contracts/product-entitlement-contract.js',
  );

  assert.equal(SAAS_PRODUCT_PLAN_DOMAIN, 'IRON_PRODUCT_PLAN');
  assert.equal(
    STUDENT_FINANCIAL_SUBSCRIPTION_DOMAIN,
    'STUDENT_FINANCIAL_SUBSCRIPTION',
  );
  assert.notEqual(SAAS_PRODUCT_PLAN_DOMAIN, STUDENT_FINANCIAL_SUBSCRIPTION_DOMAIN);
});

test('PE0 validates immutable semantic plan references as planCode plus positive version', () => {
  const { definePlanVersionReference } = require(
    '../dist/src/modules/product-entitlements/contracts/product-entitlement-contract.js',
  );

  assert.deepEqual(definePlanVersionReference({ planCode: 'IRON_BASE', version: 1 }), {
    planCode: 'IRON_BASE',
    version: 1,
  });
  assert.throws(
    () => definePlanVersionReference({ planCode: 'bad plan', version: 1 }),
    /planCode canonico invalido/,
  );
  assert.throws(
    () => definePlanVersionReference({ planCode: 'IRON_BASE', version: 0 }),
    /version deve ser inteiro positivo/,
  );
});

test('PE0 formalizes YouTube launch bridge without removing legacy Exercise.videoUrl', async () => {
  const { PRODUCT_FEATURE_CATALOG_V1 } = require(
    '../dist/src/modules/product-entitlements/contracts/product-entitlement-contract.js',
  );
  const schema = await source('prisma/schema.prisma');
  const docs = await source('docs/PE0_PRODUCT_PLAN_FEATURE_ARCHITECTURE.md');

  const youtube = PRODUCT_FEATURE_CATALOG_V1.find(
    (feature) => feature.key === 'content.external_youtube',
  );
  const delivery = PRODUCT_FEATURE_CATALOG_V1.find(
    (feature) => feature.key === 'content.delivery_mode',
  );

  assert.equal(youtube?.kind, 'FEATURE');
  assert.equal(delivery?.kind, 'POLICY');
  assert.ok(delivery.allowedPolicyValues.includes('YOUTUBE_EXTERNAL'));
  assert.match(schema, /model Exercise[\s\S]*?videoUrl\s+String\?/);
  assert.match(docs, /`Exercise\.videoUrl` permanece fallback compatível/);
  assert.match(docs, /EXTERNAL_REFERENCE/);
});

test('PE0 contract remains persistence-free and delegates persistence/runtime to later PE blocks', async () => {
  const contract = await source(
    'src/modules/product-entitlements/contracts/product-entitlement-contract.ts',
  );
  const docs = await source('docs/PE0_PRODUCT_PLAN_FEATURE_ARCHITECTURE.md');

  assert.equal(contract.includes('@prisma/client'), false);
  assert.equal(contract.includes('PrismaService'), false);
  assert.equal(contract.includes('price'), false);
  assert.match(docs, /Nenhuma migration é criada em PE0/);
  assert.match(docs, /domínio persistente[\s\S]*PE1\/PE2/);
  assert.match(docs, /resolução runtime de entitlements/);
});
