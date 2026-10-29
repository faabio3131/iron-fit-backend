import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

test('C6 provider catalog returns only safe descriptor metadata and active environment', () => {
  const { IntegrationProviderCatalogController } = require(
    '../dist/src/modules/integrations/integration-provider-catalog.controller.js',
  );
  const controller = new IntegrationProviderCatalogController(
    {
      list: () => [{
        providerCode: 'example',
        capabilities: ['payments.charge'],
        authModels: ['API_KEY'],
        environments: ['HOMOLOG'],
        supportsWebhook: true,
        supportsOAuth: false,
        tenantEntitlementFeatureKey: 'integration.example',
      }],
    },
    { current: () => 'HOMOLOG' },
  );
  const result = controller.list({ roles: ['OWNER'] });
  assert.equal(result.environment, 'HOMOLOG');
  assert.deepEqual(result.providers, [{
    providerCode: 'example',
    capabilities: ['payments.charge'],
    authModels: ['API_KEY'],
    environments: ['HOMOLOG'],
    supportsWebhook: true,
    supportsOAuth: false,
    tenantEntitlementFeatureKey: 'integration.example',
  }]);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('gymId'), false);
});

test('C6 provider catalog is authenticated and contains no secret/Vault fields', async () => {
  const source = await readFile(
    'src/modules/integrations/integration-provider-catalog.controller.ts',
    'utf8',
  );
  assert.match(source, /JwtAuthGuard/);
  assert.match(source, /RolesGuard/);
  assert.match(source, /@Roles\('OWNER', 'SUPER_ADMIN'\)/);
  assert.doesNotMatch(source, /secretReference|vaultId|keyId|token|password/i);
});


test('C6 provider registry validates configurable tenant entitlement binding', () => {
  const { IntegrationProviderRegistry } = require(
    '../dist/src/modules/integrations/provider-registry.service.js',
  );
  const registry = new IntegrationProviderRegistry();
  const registered = registry.register({
    providerCode: 'bound_example',
    capabilities: ['payments.charge'],
    authModels: ['API_KEY'],
    environments: ['HOMOLOG'],
    supportsWebhook: false,
    supportsOAuth: false,
    tenantEntitlementFeatureKey: 'integration.bound_example',
  });
  assert.equal(
    registered.tenantEntitlementFeatureKey,
    'integration.bound_example',
  );
  assert.throws(
    () => registry.register({
      providerCode: 'invalid_binding',
      capabilities: ['payments.refund'],
      authModels: ['API_KEY'],
      environments: ['HOMOLOG'],
      supportsWebhook: false,
      supportsOAuth: false,
      tenantEntitlementFeatureKey: 'PREMIUM_HARDCODED',
    }),
    /tenantEntitlementFeatureKey invalida/,
  );
});


test('Provedores da FM (sem entitlement de tenant) só aparecem para SUPER_ADMIN', () => {
  const { IntegrationProviderCatalogController } = require(
    '../dist/src/modules/integrations/integration-provider-catalog.controller.js',
  );
  const base = { capabilities: ['x.y'], authModels: ['API_KEY'], environments: ['HOMOLOG'], supportsWebhook: false, supportsOAuth: false };
  const controller = new IntegrationProviderCatalogController(
    {
      list: () => [
        { ...base, providerCode: 'openai_compatible' },
        { ...base, providerCode: 'meta', tenantEntitlementFeatureKey: 'integration.meta' },
      ],
    },
    { current: () => 'HOMOLOG' },
  );
  const owner = controller.list({ roles: ['OWNER'] }).providers.map((p) => p.providerCode);
  const manager = controller.list({ roles: ['MANAGER'] }).providers.map((p) => p.providerCode);
  const platform = controller.list({ roles: ['SUPER_ADMIN'] }).providers.map((p) => p.providerCode);
  assert.deepEqual(owner, ['meta']);
  assert.deepEqual(manager, ['meta']);
  assert.deepEqual(platform, ['openai_compatible', 'meta']);
  assert.deepEqual(controller.list().providers.map((p) => p.providerCode), ['meta']);
});
