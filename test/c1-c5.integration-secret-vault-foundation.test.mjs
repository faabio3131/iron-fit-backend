import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const schema = fs.readFileSync('prisma/integrations.prisma', 'utf8');
const migration = fs.readFileSync(
  'prisma/migrations/20260927135000_integration_secret_vault_foundation/migration.sql',
  'utf8',
);
const registrySource = fs.readFileSync(
  'src/modules/integrations/integration-provider.registry.ts',
  'utf8',
);
const resolverSource = fs.readFileSync(
  'src/modules/integrations/integration-secret-resolver.service.ts',
  'utf8',
);
const vaultSource = fs.readFileSync(
  'src/modules/integrations/vault/openbao-integration-vault.adapter.ts',
  'utf8',
);
const envExample = fs.readFileSync('.env.example', 'utf8');

test('C1 provider registry is provider-neutral and rejects duplicate/unknown providers', () => {
  const { IntegrationProviderRegistry } = require(
    '../dist/src/modules/integrations/integration-provider.registry.js'
  );
  const { IntegrationEnvironment } = require('@prisma/client');
  const registry = new IntegrationProviderRegistry();

  registry.register({
    providerCode: 'certification_provider',
    authModel: 'API_KEY',
    capabilities: ['certification.read'],
    environments: [IntegrationEnvironment.DEV],
    publicConfigurationKeys: ['accountId'],
    secretKeys: ['apiKey'],
  });

  assert.equal(
    registry.get('CERTIFICATION_PROVIDER').providerCode,
    'certification_provider',
  );
  assert.equal(registry.list()[0].requiresSecret, true);
  assert.throws(() => registry.get('missing_provider'));
  assert.throws(() =>
    registry.register({
      providerCode: 'certification_provider',
      authModel: 'API_KEY',
      capabilities: [],
      environments: [IntegrationEnvironment.DEV],
      publicConfigurationKeys: [],
      secretKeys: [],
    }),
  );
  assert.doesNotMatch(
    registrySource,
    /mercado[_ -]?pago|pagbank|meta|google/i,
  );
});

test('C2-C3 schema stores tenant/global authority and opaque references but no reusable secret value', () => {
  assert.match(schema, /model IntegrationConnection/);
  assert.match(schema, /scope\s+IntegrationScope/);
  assert.match(schema, /gymId\s+String\?/);
  assert.match(schema, /publicConfiguration\s+Json\?/);
  assert.match(schema, /model IntegrationSecretVersion/);
  assert.match(schema, /referenceId\s+String\s+@unique/);
  assert.doesNotMatch(
    schema,
    /apiKey|accessToken|refreshToken|webhookSecret|secretValue|ciphertext/i,
  );

  assert.match(migration, /IntegrationConnection_scope_gym_check/);
  assert.match(
    migration,
    /IntegrationConnection_global_provider_environment_key/,
  );
  assert.match(
    migration,
    /IntegrationConnection_tenant_provider_environment_key/,
  );
});

test('C4 uses a real OpenBao KV v2 backend and permanently removes revoked reference material', async () => {
  process.env.NODE_ENV = 'test';
  process.env.INTEGRATION_VAULT_ADDR = 'http://127.0.0.1:8200';
  process.env.INTEGRATION_VAULT_TOKEN = 'root';
  process.env.INTEGRATION_VAULT_MOUNT = 'secret';
  process.env.INTEGRATION_VAULT_TIMEOUT_MS = '5000';

  const { ConfigService } = require('@nestjs/config');
  const { OpenBaoIntegrationVaultAdapter } = require(
    '../dist/src/modules/integrations/vault/openbao-integration-vault.adapter.js'
  );
  const adapter = new OpenBaoIntegrationVaultAdapter(new ConfigService());
  const path =
    `iron-fit/dev/tenant/${randomUUID()}/${randomUUID()}/${randomUUID()}`;
  const generatedSecret = `ci-${randomUUID()}`;

  const written = await adapter.put(path, { apiKey: generatedSecret });
  assert.ok(written.version > 0);

  const resolved = await adapter.get(path);
  assert.deepEqual(resolved, { apiKey: generatedSecret });

  await adapter.destroy(path);
  await assert.rejects(() => adapter.get(path));
});

test('C4 fails closed without vault configuration and forbids non-local HTTP', async () => {
  const { ConfigService } = require('@nestjs/config');
  const { OpenBaoIntegrationVaultAdapter } = require(
    '../dist/src/modules/integrations/vault/openbao-integration-vault.adapter.js'
  );

  const previous = {
    addr: process.env.INTEGRATION_VAULT_ADDR,
    token: process.env.INTEGRATION_VAULT_TOKEN,
    node: process.env.NODE_ENV,
  };

  try {
    delete process.env.INTEGRATION_VAULT_ADDR;
    delete process.env.INTEGRATION_VAULT_TOKEN;
    const missing = new OpenBaoIntegrationVaultAdapter(new ConfigService());
    await assert.rejects(() =>
      missing.get('iron-fit/dev/global/a/b'),
    );

    process.env.NODE_ENV = 'production';
    process.env.INTEGRATION_VAULT_ADDR = 'http://vault.example.invalid';
    process.env.INTEGRATION_VAULT_TOKEN = 'not-a-real-token';
    const insecure = new OpenBaoIntegrationVaultAdapter(new ConfigService());
    await assert.rejects(() =>
      insecure.get('iron-fit/prod/global/a/b'),
    );
  } finally {
    if (previous.addr === undefined) delete process.env.INTEGRATION_VAULT_ADDR;
    else process.env.INTEGRATION_VAULT_ADDR = previous.addr;
    if (previous.token === undefined) delete process.env.INTEGRATION_VAULT_TOKEN;
    else process.env.INTEGRATION_VAULT_TOKEN = previous.token;
    if (previous.node === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.node;
  }
});

test('C5 resolver rejects cross-tenant and cross-environment access before revealing a secret', () => {
  assert.match(
    resolverSource,
    /connection\.scope !== context\.scope/,
  );
  assert.match(
    resolverSource,
    /connection\.gymId !== context\.gymId/,
  );
  assert.match(
    resolverSource,
    /assertRuntimeEnvironment\(connection\.environment\)/,
  );
  assert.match(
    resolverSource,
    /connection\.status !== IntegrationConnectionStatus\.ACTIVE/,
  );
  assert.match(
    resolverSource,
    /IntegrationSecretStatus\.EXPIRED/,
  );
  assert.match(vaultSource, /X-Vault-Token/);
  assert.doesNotMatch(vaultSource, /console\.(log|error)|Logger/);
});

test('C5 runtime environment is explicit and vault credential is never committed to env example', () => {
  assert.match(envExample, /INTEGRATION_RUNTIME_ENV=/);
  assert.match(envExample, /INTEGRATION_VAULT_TOKEN=\n/);
  assert.doesNotMatch(envExample, /INTEGRATION_VAULT_TOKEN=.+\S/);
});
