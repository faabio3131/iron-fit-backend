import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DOC = 'docs/CN0_CREATOR_NETWORK_ARCHITECTURE_RIGHTS_BUSINESS_CAPABILITY_MAP.md';

async function source(path) {
  return readFile(path, 'utf8');
}

test('CN0 distinguishes external references from managed content and rights provenance', () => {
  const {
    CREATOR_CONTENT_RELATION_KINDS,
    requiresManagedRightsProvenance,
    canHostManagedMedia,
  } = require(
    '../dist/src/modules/creator-network/contracts/creator-network-contract.js',
  );

  assert.deepEqual(CREATOR_CONTENT_RELATION_KINDS, [
    'EXTERNAL_REFERENCE',
    'LICENSED_CONTENT',
    'IRON_OWNED',
    'TENANT_OWNED',
  ]);

  assert.equal(requiresManagedRightsProvenance('EXTERNAL_REFERENCE'), false);
  assert.equal(canHostManagedMedia('EXTERNAL_REFERENCE'), false);

  for (const kind of ['LICENSED_CONTENT', 'IRON_OWNED', 'TENANT_OWNED']) {
    assert.equal(requiresManagedRightsProvenance(kind), true);
    assert.equal(canHostManagedMedia(kind), true);
  }
});

test('CN0 rights model requires all minimum provenance dimensions', () => {
  const { CREATOR_RIGHTS_DIMENSIONS } = require(
    '../dist/src/modules/creator-network/contracts/creator-network-contract.js',
  );

  assert.deepEqual(CREATOR_RIGHTS_DIMENSIONS, [
    'RIGHTS_HOLDER',
    'LICENSE_BASIS',
    'USAGE_SCOPE',
    'DELIVERY_SCOPE',
    'TERRITORY',
    'VALIDITY_WINDOW',
    'REVOCATION_STATUS',
    'ATTRIBUTION_REQUIREMENT',
  ]);
});

test('CN0 capability map covers CN0-CN9 exactly with unique canonical keys', () => {
  const {
    CREATOR_NETWORK_BLOCKS,
    CREATOR_NETWORK_CAPABILITY_MAP_V1,
    assertCreatorNetworkCapabilityMap,
  } = require(
    '../dist/src/modules/creator-network/contracts/creator-network-contract.js',
  );

  assert.doesNotThrow(() =>
    assertCreatorNetworkCapabilityMap(CREATOR_NETWORK_CAPABILITY_MAP_V1),
  );
  assert.deepEqual(CREATOR_NETWORK_BLOCKS, [
    'CN0',
    'CN1',
    'CN2',
    'CN3',
    'CN4',
    'CN5',
    'CN6',
    'CN7',
    'CN8',
    'CN9',
  ]);
  assert.equal(CREATOR_NETWORK_CAPABILITY_MAP_V1.length, 10);
  assert.equal(
    new Set(CREATOR_NETWORK_CAPABILITY_MAP_V1.map((item) => item.key)).size,
    10,
  );
  assert.deepEqual(
    CREATOR_NETWORK_CAPABILITY_MAP_V1.map((item) => item.ownerBlock),
    CREATOR_NETWORK_BLOCKS,
  );
});

test('CN0 preserves Launch Bridge and legacy Exercise.videoUrl without inventing rights', async () => {
  const docs = await source(DOC);
  const schema = await source('prisma/schema.prisma');

  assert.match(schema, /model Exercise[\s\S]*?videoUrl\s+String\?/);
  assert.match(docs, /`Exercise\.videoUrl` permanece fallback compatível/);
  assert.match(docs, /link público externo permanece `EXTERNAL_REFERENCE`/);
  assert.match(docs, /não implica licença, propriedade ou direito de exploração comercial/);
  assert.match(docs, /retirada futura de `Exercise\.videoUrl` exige bloco próprio/);
});

test('CN0 consumes PE0-PE4 entitlements without commercial plan-name coupling', () => {
  const { PRODUCT_FEATURE_CATALOG_V1 } = require(
    '../dist/src/modules/product-entitlements/contracts/product-entitlement-contract.js',
  );

  const featureByKey = new Map(
    PRODUCT_FEATURE_CATALOG_V1.map((feature) => [feature.key, feature]),
  );

  assert.equal(featureByKey.get('content.external_youtube')?.kind, 'FEATURE');
  assert.equal(featureByKey.get('content.iron_managed')?.kind, 'FEATURE');
  assert.equal(featureByKey.get('content.tenant_private')?.kind, 'FEATURE');
  assert.equal(featureByKey.get('content.private_items_max')?.kind, 'LIMIT');
  assert.equal(featureByKey.get('content.delivery_mode')?.kind, 'POLICY');
});

test('CN0 remains architecture-only and separates creator settlement from existing financial domains', async () => {
  const contract = await source(
    'src/modules/creator-network/contracts/creator-network-contract.ts',
  );
  const docs = await source(DOC);

  assert.equal(contract.includes('@prisma/client'), false);
  assert.equal(contract.includes('PrismaService'), false);
  assert.match(docs, /Prisma models ou migrations/);
  assert.match(docs, /`STUDENT_FINANCIAL_SUBSCRIPTION`/);
  assert.match(docs, /`IRON_PRODUCT_PLAN`/);
  assert.match(docs, /CN0 não define fórmula de revenue share, preço, comissão, payout, moeda, gateway/);
});
