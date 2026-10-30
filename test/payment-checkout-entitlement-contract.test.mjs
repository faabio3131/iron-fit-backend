import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('canonical payment entitlement exists as FINANCIAL feature without mutating published plan versions', async () => {
  const [migration, manifest, contracts] = await Promise.all([
    readFile('prisma/migrations/20261029210000_tenant_payment_checkout_capability/migration.sql', 'utf8'),
    readFile('config/commercial/iron-v1-launch.json', 'utf8'),
    readFile('src/modules/product-entitlements/contracts/product-entitlement-contract.ts', 'utf8'),
  ]);
  assert.match(migration, /billing\.student\.checkout/);
  assert.match(migration, /'FINANCIAL'/);
  assert.match(migration, /ON CONFLICT \("key"\) DO NOTHING/);
  assert.doesNotMatch(migration, /UPDATE\s+"ProductPlanVersion"|INSERT INTO "ProductPlanEntitlement"/);
  assert.match(contracts, /'FINANCIAL'/);
  const data = JSON.parse(manifest);
  for (const plan of data.plans) {
    const value = plan.entitlements.find((entry) => entry.featureKey === 'billing.student.checkout');
    assert.equal(value?.featureEnabled, true);
  }
});
