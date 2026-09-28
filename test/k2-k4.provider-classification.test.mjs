import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(path, 'utf8');
}

test('K2 canonical launch keeps Creator IRON-managed and tenant-private capabilities OUT', async () => {
  const manifest = JSON.parse(
    await source('config/commercial/iron-v1-launch.json'),
  );
  const items = new Map(
    manifest.launchItems.map((item) => [item.itemKey, item]),
  );

  assert.equal(
    items.get('creator.iron_managed')?.decision,
    'OUT',
  );
  assert.equal(
    items.get('creator.tenant_private')?.decision,
    'OUT',
  );

  for (const plan of manifest.plans) {
    const granted = new Set(
      plan.entitlements
        .filter((entry) => entry.featureEnabled === true)
        .map((entry) => entry.featureKey),
    );
    assert.equal(granted.has('content.iron_managed'), false);
    assert.equal(granted.has('content.tenant_private'), false);
  }
});

test('K3/K4 canonical launch preserves Wellhub and TotalPass as EXTERNAL_BLOCKER', async () => {
  const manifest = JSON.parse(
    await source('config/commercial/iron-v1-launch.json'),
  );
  const items = new Map(
    manifest.launchItems.map((item) => [item.itemKey, item]),
  );

  for (const key of [
    'provider.wellhub',
    'provider.totalpass',
  ]) {
    const item = items.get(key);
    assert.equal(item?.decision, 'EXTERNAL_BLOCKER');
    assert.ok(item?.blockerOwner);
    assert.ok(item?.evidenceRequirement);
  }
});

test('K3 Wellhub adapter stays fail-closed when partner transport/homologation is unavailable', async () => {
  const sourceText = await source(
    'src/modules/aggregator/providers/wellhub/wellhub-adapter.service.ts',
  );

  assert.match(sourceText, /WELLHUB_NOT_HOMOLOGATED/);
  assert.match(sourceText, /WELLHUB_TRANSPORT_UNAVAILABLE/);
  assert.match(sourceText, /AggregatorEligibilityStatus\.UNKNOWN/);
  assert.doesNotMatch(
    sourceText,
    /process\.env.*WELLHUB|WELLHUB_API_KEY|WELLHUB_SECRET/,
  );
});

test('K4 TotalPass adapter stays fail-closed when partner transport/homologation is unavailable', async () => {
  const sourceText = await source(
    'src/modules/aggregator/providers/totalpass/totalpass-adapter.service.ts',
  );

  assert.match(sourceText, /TOTALPASS_NOT_HOMOLOGATED/);
  assert.match(sourceText, /TOTALPASS_TRANSPORT_UNAVAILABLE/);
  assert.match(sourceText, /AggregatorEligibilityStatus\.UNKNOWN/);
  assert.doesNotMatch(
    sourceText,
    /process\.env.*TOTALPASS|TOTALPASS_API_KEY|TOTALPASS_SECRET/,
  );
});

test('K2-K4 classification documentation never promotes external blockers to homologated', async () => {
  const docs = await source(
    'docs/K2_K4_PROVIDER_CLASSIFICATION.md',
  );

  assert.match(docs, /K2 OUT for V1/);
  assert.match(docs, /K3\/K4 BLOCKED_EXTERNAL/);
  assert.match(docs, /EXTERNAL_BLOCKER/);
  assert.match(docs, /physical homologation evidence/i);
});
