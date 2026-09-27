import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const reference = 'isv_' + 'A'.repeat(43);

function bundle(overrides = {}) {
  return {
    secretId: 'ocid1.vaultsecret.oc1..example',
    versionNumber: 1,
    secretBundleContent: {
      contentType: 'BASE64',
      content: Buffer.from('provider-secret', 'utf8').toString('base64'),
    },
    ...overrides,
  };
}

function factory(overrides = {}) {
  const state = {
    created: [],
    updated: [],
    deleted: [],
    current: bundle(),
  };
  const clients = {
    settings: {
      authMode: 'INSTANCE_PRINCIPAL',
      compartmentId: 'ocid1.compartment.oc1..example',
      vaultId: 'ocid1.vault.oc1..example',
      keyId: 'ocid1.key.oc1..example',
    },
    secretsClient: {
      getSecretBundleByName: async () => ({ secretBundle: state.current }),
    },
    vaultsClient: {
      createSecret: async (request) => {
        state.created.push(request);
        return {
          secret: {
            currentVersionNumber: 1,
            timeOfCurrentVersionExpiry: null,
          },
        };
      },
      updateSecret: async (request) => {
        state.updated.push(request);
        state.current = bundle({
          versionNumber: 2,
          secretBundleContent: {
            contentType: 'BASE64',
            content: request.updateSecretDetails.secretContent.content,
          },
        });
        return {
          secret: {
            currentVersionNumber: 2,
            timeOfCurrentVersionExpiry: null,
          },
        };
      },
      scheduleSecretDeletion: async (request) => {
        state.deleted.push(request);
      },
    },
    ...overrides,
  };
  return {
    state,
    clients,
    factory: { clients: async () => clients },
  };
}

test('C4A OCI adapter creates opaque-reference secret with Base64 transport only', async () => {
  const { OciIntegrationSecretVaultAdapter } = require(
    '../dist/src/modules/integrations/secrets/oci/oci-integration-secret-vault.adapter.js',
  );
  const fake = factory();
  const adapter = new OciIntegrationSecretVaultAdapter(fake.factory);
  const result = await adapter.putSecret({
    reference,
    value: 'provider-secret',
  });

  assert.equal(result.version, 1);
  assert.equal(fake.state.created.length, 1);
  const details = fake.state.created[0].createSecretDetails;
  assert.equal(details.secretName, reference);
  assert.equal(details.vaultId, 'ocid1.vault.oc1..example');
  assert.equal(details.content, undefined);
  assert.equal(
    Buffer.from(details.secretContent.content, 'base64').toString('utf8'),
    'provider-secret',
  );
  assert.equal(JSON.stringify(details).includes('provider-secret'), false);
});

test('C4A OCI adapter rotates only from the expected physical version', async () => {
  const { OciIntegrationSecretVaultAdapter } = require(
    '../dist/src/modules/integrations/secrets/oci/oci-integration-secret-vault.adapter.js',
  );
  const fake = factory();
  const adapter = new OciIntegrationSecretVaultAdapter(fake.factory);

  await assert.rejects(
    adapter.putSecret({
      reference,
      value: 'new-secret',
      expectedVersion: 9,
    }),
    /Versao esperada/,
  );
  assert.equal(fake.state.updated.length, 0);

  const rotated = await adapter.putSecret({
    reference,
    value: 'new-secret',
    expectedVersion: 1,
  });
  assert.equal(rotated.version, 2);
  assert.equal(fake.state.updated.length, 1);
});

test('C4A OCI adapter retrieves CURRENT and decodes without exposing Base64 to caller', async () => {
  const { OciIntegrationSecretVaultAdapter } = require(
    '../dist/src/modules/integrations/secrets/oci/oci-integration-secret-vault.adapter.js',
  );
  const fake = factory();
  const adapter = new OciIntegrationSecretVaultAdapter(fake.factory);
  const result = await adapter.getSecret(reference);
  assert.deepEqual(result, {
    value: 'provider-secret',
    version: 1,
    expiresAt: null,
  });
});

test('C4A OCI adapter revocation schedules physical deletion at least one day ahead', async () => {
  const { OciIntegrationSecretVaultAdapter } = require(
    '../dist/src/modules/integrations/secrets/oci/oci-integration-secret-vault.adapter.js',
  );
  const fake = factory();
  const adapter = new OciIntegrationSecretVaultAdapter(fake.factory);
  const before = Date.now();
  await adapter.revokeSecret(reference);
  assert.equal(fake.state.deleted.length, 1);
  const at = fake.state.deleted[0].scheduleSecretDeletionDetails.timeOfDeletion.getTime();
  assert.ok(at - before >= 24 * 60 * 60 * 1000);
  assert.ok(at - before <= 30 * 24 * 60 * 60 * 1000);
});

test('C4A enforces OCI 25 KB secret-bundle boundary before network call', async () => {
  const { OciIntegrationSecretVaultAdapter } = require(
    '../dist/src/modules/integrations/secrets/oci/oci-integration-secret-vault.adapter.js',
  );
  const fake = factory();
  const adapter = new OciIntegrationSecretVaultAdapter(fake.factory);
  await assert.rejects(
    adapter.putSecret({
      reference,
      value: 'x'.repeat(25 * 1024 + 1),
    }),
    /25 KB/,
  );
  assert.equal(fake.state.created.length, 0);
});

test('C4A production forbids CONFIG_FILE OCI credentials and accepts principal auth', () => {
  const { OciVaultConfigurationService } = require(
    '../dist/src/modules/integrations/secrets/oci/oci-vault-configuration.service.js',
  );
  const values = {
    INTEGRATION_SECRET_VAULT_BACKEND: 'OCI',
    OCI_VAULT_COMPARTMENT_ID: 'ocid1.compartment.oc1..example',
    OCI_VAULT_ID: 'ocid1.vault.oc1..example',
    OCI_VAULT_KEY_ID: 'ocid1.key.oc1..example',
    NODE_ENV: 'production',
  };
  const config = { get: (name) => values[name] };

  values.OCI_VAULT_AUTH_MODE = 'CONFIG_FILE';
  assert.throws(
    () => new OciVaultConfigurationService(config).requireSettings(),
    /CONFIG_FILE e proibido/,
  );

  values.OCI_VAULT_AUTH_MODE = 'INSTANCE_PRINCIPAL';
  assert.equal(
    new OciVaultConfigurationService(config).requireSettings().authMode,
    'INSTANCE_PRINCIPAL',
  );
});

test('C4A source never contains tenant-specific OCI credential variables', async () => {
  const source = await readFile(
    'src/modules/integrations/secrets/oci/oci-vault-configuration.service.ts',
    'utf8',
  );
  assert.doesNotMatch(source, /CLIENTE|ACADEMIA_[A-Z0-9_]+|TENANT_[A-Z0-9_]+/);
  assert.match(source, /OCI_VAULT_ID/);
  assert.match(source, /INSTANCE_PRINCIPAL/);
  assert.match(source, /RESOURCE_PRINCIPAL/);
});
