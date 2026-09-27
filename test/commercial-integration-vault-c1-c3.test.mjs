import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('C1 provider registry is provider-neutral and duplicate-safe', () => {
  const { IntegrationProviderRegistry } = require('../dist/src/modules/integrations/provider-registry.service.js');
  const registry = new IntegrationProviderRegistry();
  const descriptor = registry.register({
    providerCode: 'example_pay',
    capabilities: ['payments.charge', 'payments.refund'],
    authModels: ['API_KEY'],
    environments: ['HOMOLOG', 'PROD'],
    supportsWebhook: true,
    supportsOAuth: false,
  });
  assert.equal(descriptor.providerCode, 'example_pay');
  assert.deepEqual(descriptor.capabilities, ['payments.charge', 'payments.refund']);
  assert.equal(registry.list().length, 1);
  assert.throws(() => registry.register({
    ...descriptor,
    capabilities: [...descriptor.capabilities],
    authModels: [...descriptor.authModels],
    environments: [...descriptor.environments],
  }), /ja registrado/);
});

test('C3 secret references are opaque, random and structurally validated', () => {
  const contract = require('../dist/src/modules/integrations/contracts/integration-contract.js');
  const first = contract.newIntegrationSecretReference();
  const second = contract.newIntegrationSecretReference();
  assert.match(first, /^isv_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(contract.assertIntegrationSecretReference(first), first);
  assert.throws(() => contract.assertIntegrationSecretReference('tenant/acme/token=cleartext'));
});

test('C2 public configuration rejects secret-like fields recursively', () => {
  const { assertPublicIntegrationConfiguration } = require('../dist/src/modules/integrations/contracts/integration-contract.js');
  assert.doesNotThrow(() => assertPublicIntegrationConfiguration({
    merchantId: 'merchant-public-id',
    region: 'br',
    settings: { captureMode: 'automatic' },
  }));
  for (const forbidden of [
    { apiKey: 'secret' },
    { nested: { accessToken: 'secret' } },
    { client_secret: 'secret' },
    { payment: { cvv: '123' } },
    { cardNumber: '4111111111111111' },
  ]) {
    assert.throws(() => assertPublicIntegrationConfiguration(forbidden), /campo sensivel/);
  }
});

test('C2 connection authority enforces GLOBAL/TENANT shape and scoped lookup', async () => {
  const { IntegrationConnectionService } = require('../dist/src/modules/integrations/integration-connection.service.js');
  const { IntegrationProviderRegistry } = require('../dist/src/modules/integrations/provider-registry.service.js');

  const registry = new IntegrationProviderRegistry();
  registry.register({
    providerCode: 'example_oauth',
    capabilities: ['social.publish'],
    authModels: ['OAUTH2'],
    environments: ['HOMOLOG'],
    supportsWebhook: true,
    supportsOAuth: true,
  });

  const created = [];
  const prisma = {
    integrationConnection: {
      create: async ({ data }) => {
        created.push(data);
        return { id: 'connection-a', ...data };
      },
      findFirst: async ({ where }) => (
        where.id === 'connection-a' && where.scope === 'TENANT' && where.gymId === 'gym-a'
          ? { id: 'connection-a', ...where }
          : null
      ),
    },
  };

  const service = new IntegrationConnectionService(prisma, registry);

  await assert.rejects(
    service.create({
      scope: 'TENANT',
      providerCode: 'example_oauth',
      environment: 'HOMOLOG',
      authModel: 'OAUTH2',
      capabilities: ['social.publish'],
    }),
    /TENANT exige gymId/,
  );

  const connection = await service.create({
    scope: 'TENANT',
    gymId: 'gym-a',
    providerCode: 'example_oauth',
    environment: 'HOMOLOG',
    authModel: 'OAUTH2',
    capabilities: ['social.publish'],
    publicConfiguration: { businessId: 'public-business-id' },
  });
  assert.equal(connection.gymId, 'gym-a');
  assert.equal(created[0].secretReference, undefined);

  assert.equal((await service.findScopedById('connection-a', { scope: 'TENANT', gymId: 'gym-a' })).id, 'connection-a');
  await assert.rejects(
    service.findScopedById('connection-a', { scope: 'TENANT', gymId: 'gym-b' }),
    /nao encontrada no escopo ativo/,
  );
});

test('C1-C3 migration hardens scope, partial uniqueness and opaque secret references', async () => {
  const migration = await readFile('prisma/migrations/20260927140500_integration_secret_vault_c1_c3/migration.sql', 'utf8');
  assert.match(migration, /IntegrationConnection_scope_shape/);
  assert.match(migration, /global_provider_env_key/);
  assert.match(migration, /tenant_provider_env_key/);
  assert.match(migration, /\^isv_/);
  assert.doesNotMatch(migration, /apiKey|accessToken|refreshToken|clientSecret|webhookSecret/);
});

test('C1-C3 module exposes no controller and therefore no premature credential API', async () => {
  const moduleSource = await readFile('src/modules/integrations/integrations.module.ts', 'utf8');
  assert.match(moduleSource, /IntegrationProviderRegistry/);
  assert.match(moduleSource, /IntegrationConnectionService/);
  assert.doesNotMatch(moduleSource, /controllers:/);
});
