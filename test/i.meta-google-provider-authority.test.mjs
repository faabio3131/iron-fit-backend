import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const read = (path) => readFile(path, 'utf8');

test('I bootstraps Meta as one umbrella provider and Google as a separate OAuth provider', () => {
  const { IntegrationProviderRegistry } = require(
    '../dist/src/modules/integrations/provider-registry.service.js',
  );
  const { IntegrationProviderBootstrapService } = require(
    '../dist/src/modules/integrations/integration-provider-bootstrap.service.js',
  );

  const registry = new IntegrationProviderRegistry();
  const bootstrap = new IntegrationProviderBootstrapService(registry);
  bootstrap.onModuleInit();

  const meta = registry.require('meta');
  assert.deepEqual(meta.capabilities, [
    'meta.facebook',
    'meta.instagram',
    'meta.whatsapp',
  ]);
  assert.deepEqual(meta.authModels, ['OAUTH2']);
  assert.equal(meta.supportsOAuth, true);
  assert.equal(meta.supportsWebhook, true);
  assert.equal(meta.tenantEntitlementFeatureKey, 'integration.meta');

  const google = registry.require('google');
  assert.deepEqual(google.capabilities, ['google.oauth']);
  assert.deepEqual(google.authModels, ['OAUTH2']);
  assert.equal(google.supportsOAuth, true);
  assert.equal(google.tenantEntitlementFeatureKey, 'integration.google');

  // Meta, Google and fiscal providers remain unchanged; FM-only AI providers
  // extend the catalog without granting academy control of API credentials.
  assert.equal(registry.list().length, 8);
  const email = registry.require('resend');
  assert.deepEqual(email.capabilities, ['email.transactional']);
  assert.equal(email.tenantEntitlementFeatureKey, undefined);
  const payment = registry.require('mercado_pago');
  assert.deepEqual(payment.capabilities, ['billing.student.checkout']);
  assert.equal(payment.tenantEntitlementFeatureKey, 'billing.student.checkout');
  for (const code of ['openai_compatible', 'gemini_native']) {
    const ai = registry.require(code);
    assert.deepEqual(ai.authModels, ['API_KEY']);
    assert.equal(ai.tenantEntitlementFeatureKey, undefined);
    assert.ok(ai.capabilities.includes('ai.advisory_chat'));
  }
  const fiscal = registry.require('fm-fiscal-core');
  assert.deepEqual(fiscal.capabilities, ['fiscal.bridge']);
  assert.deepEqual(fiscal.authModels, ['ACCESS_TOKEN']);
  assert.equal(fiscal.supportsOAuth, false);
  const evolution = registry.require('evolution');
  assert.deepEqual(evolution.capabilities, ['evolution.whatsapp']);
  assert.deepEqual(evolution.authModels, ['API_KEY']);
  assert.equal(evolution.supportsWebhook, true);
  assert.equal(evolution.tenantEntitlementFeatureKey, 'integration.meta');
  assert.equal(registry.list().some((p) => p.providerCode === 'facebook'), false);
  assert.equal(registry.list().some((p) => p.providerCode === 'instagram'), false);
  assert.equal(registry.list().some((p) => p.providerCode === 'whatsapp'), false);
});

test('I persists Meta and Google as configurable tenant entitlements', async () => {
  const migration = await read(
    'prisma/migrations/20260928025500_meta_google_integration_capabilities/migration.sql',
  );
  assert.match(migration, /integration\.meta/);
  assert.match(migration, /integration\.google/);
  assert.match(migration, /'INTEGRATION'/);
  assert.match(migration, /'FEATURE'/);
});

test('I commercial V1 ties Meta and Google launch items to plan entitlements', async () => {
  const manifest = JSON.parse(
    await read('config/commercial/iron-v1-launch.json'),
  );

  for (const plan of manifest.plans) {
    const byKey = new Map(plan.entitlements.map((entry) => [entry.featureKey, entry]));
    assert.equal(byKey.get('integration.meta')?.featureEnabled, true);
    assert.equal(byKey.get('integration.google')?.featureEnabled, true);
  }

  const items = new Map(
    manifest.launchItems.map((item) => [item.itemKey, item]),
  );
  assert.equal(items.get('channel.meta')?.decision, 'LAUNCH');
  assert.equal(items.get('channel.meta')?.featureKey, 'integration.meta');
  assert.equal(items.get('channel.google')?.decision, 'LAUNCH');
  assert.equal(items.get('channel.google')?.featureKey, 'integration.google');
});

test('I runtime does not hardcode provider app ids, client secrets or tenant tokens', async () => {
  const bootstrap = await read(
    'src/modules/integrations/integration-provider-bootstrap.service.ts',
  );
  assert.doesNotMatch(
    bootstrap,
    /client[_-]?id\s*[:=]|client[_-]?secret\s*[:=]|access[_-]?token\s*[:=]|refresh[_-]?token\s*[:=]/i,
  );
  assert.match(bootstrap, /tenantEntitlementFeatureKey: 'integration\.meta'/);
  assert.match(bootstrap, /tenantEntitlementFeatureKey: 'integration\.google'/);
});
