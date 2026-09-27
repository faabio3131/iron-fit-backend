import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

function baseConnection(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    scope: 'TENANT',
    gymId: 'gym-a',
    providerCode: 'example_pay',
    environment: 'HOMOLOG',
    authModel: 'API_KEY',
    status: 'ACTIVE',
    capabilities: ['payments.charge'],
    publicConfiguration: { merchantId: 'public-id' },
    secretReference: 'isv_' + 'A'.repeat(43),
    secretVersion: 1,
    secretRotatedAt: new Date('2026-09-27T10:00:00.000Z'),
    secretExpiresAt: null,
    secretLastUsedAt: null,
    secretRevokedAt: null,
    lastVerifiedAt: new Date('2026-09-27T10:00:00.000Z'),
    createdAt: new Date('2026-09-27T10:00:00.000Z'),
    updatedAt: new Date('2026-09-27T10:00:00.000Z'),
    ...overrides,
  };
}

test('C6 safe list never returns secretReference or secret material', async () => {
  const { IntegrationCredentialAdminService } = require(
    '../dist/src/modules/integrations/integration-credential-admin.service.js',
  );
  const prisma = {
    integrationConnection: {
      findMany: async () => [baseConnection()],
    },
  };
  const service = new IntegrationCredentialAdminService(
    prisma,
    {},
    {},
    { current: () => 'HOMOLOG' },
    {},
    {},
  );

  const [view] = await service.list({ scope: 'TENANT', gymId: 'gym-a' });
  assert.equal(view.credentialConfigured, true);
  assert.equal(Object.hasOwn(view, 'secretReference'), false);
  assert.equal(JSON.stringify(view).includes('isv_'), false);
  assert.equal(JSON.stringify(view).includes('provider-secret'), false);
});

test('C7 every credential mutation performs step-up before Vault access', async () => {
  const { IntegrationCredentialAdminService } = require(
    '../dist/src/modules/integrations/integration-credential-admin.service.js',
  );
  let stepUps = 0;
  let vaultCalls = 0;
  const auth = {
    assertStepUp: async () => {
      stepUps += 1;
      throw new Error('STEP_UP_REQUIRED_TEST');
    },
  };
  const vault = {
    putSecret: async () => {
      vaultCalls += 1;
      return { version: 1 };
    },
    getSecret: async () => {
      vaultCalls += 1;
      return { value: 'secret', version: 1 };
    },
    revokeSecret: async () => {
      vaultCalls += 1;
    },
  };
  const service = new IntegrationCredentialAdminService(
    { integrationConnection: {} },
    auth,
    {},
    { current: () => 'HOMOLOG' },
    {},
    vault,
  );
  const scope = { scope: 'TENANT', gymId: 'gym-a' };
  const step = { currentPassword: 'Strong-Pass-2026!' };

  await assert.rejects(
    service.create(scope, 'user-a', {
      ...step,
      providerCode: 'example_pay',
      environment: 'HOMOLOG',
      authModel: 'API_KEY',
      capabilities: ['payments.charge'],
      secret: 'secret',
    }),
    /STEP_UP_REQUIRED_TEST/,
  );
  await assert.rejects(
    service.rotate(scope, baseConnection().id, 'user-a', { ...step, secret: 'new' }),
    /STEP_UP_REQUIRED_TEST/,
  );
  await assert.rejects(
    service.verify(scope, baseConnection().id, 'user-a', step),
    /STEP_UP_REQUIRED_TEST/,
  );
  await assert.rejects(
    service.revoke(scope, baseConnection().id, 'user-a', step),
    /STEP_UP_REQUIRED_TEST/,
  );
  assert.equal(stepUps, 4);
  assert.equal(vaultCalls, 0);
});

test('C8 rotation updates only when canonical version is unchanged', async () => {
  const { IntegrationCredentialAdminService } = require(
    '../dist/src/modules/integrations/integration-credential-admin.service.js',
  );
  const connection = baseConnection();
  let updateWhere;
  const prisma = {
    integrationConnection: {
      findFirst: async () => connection,
    },
    $transaction: async (fn) => fn({
      integrationConnection: {
        updateMany: async ({ where }) => {
          updateWhere = where;
          return { count: 1 };
        },
        findUniqueOrThrow: async () => baseConnection({
          secretVersion: 2,
          secretRotatedAt: new Date(),
        }),
      },
      auditLog: { create: async () => ({}) },
    }),
  };
  const service = new IntegrationCredentialAdminService(
    prisma,
    { assertStepUp: async () => ({}) },
    {},
    { current: () => 'HOMOLOG' },
    { record: async () => ({}) },
    {
      putSecret: async ({ expectedVersion }) => {
        assert.equal(expectedVersion, 1);
        return { version: 2 };
      },
    },
  );
  const result = await service.rotate(
    { scope: 'TENANT', gymId: 'gym-a' },
    connection.id,
    'user-a',
    { currentPassword: 'Strong-Pass-2026!', secret: 'new-secret' },
  );
  assert.equal(result.secretVersion, 2);
  assert.equal(updateWhere.secretVersion, 1);
  assert.equal(updateWhere.secretRevokedAt, null);
});

test('C8 revoke blocks canonical DB before physical Vault revocation', async () => {
  const { IntegrationCredentialAdminService } = require(
    '../dist/src/modules/integrations/integration-credential-admin.service.js',
  );
  const events = [];
  const connection = baseConnection();
  const tx = {
    integrationConnection: {
      update: async () => {
        events.push('DB_REVOKED');
        return {};
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const prisma = {
    integrationConnection: {
      findFirst: async () => connection,
    },
    $transaction: async (fn) => fn(tx),
  };
  const service = new IntegrationCredentialAdminService(
    prisma,
    { assertStepUp: async () => ({}) },
    {},
    { current: () => 'HOMOLOG' },
    { record: async () => events.push('AUDIT') },
    {
      revokeSecret: async () => {
        events.push('VAULT_REVOKED');
      },
    },
  );
  await service.revoke(
    { scope: 'TENANT', gymId: 'gym-a' },
    connection.id,
    'user-a',
    { currentPassword: 'Strong-Pass-2026!' },
  );
  assert.ok(events.indexOf('DB_REVOKED') < events.indexOf('VAULT_REVOKED'));
});

test('C6 tenant and global routes expose no GET secret/read endpoint', async () => {
  const tenant = await readFile(
    'src/modules/integrations/integration-credential-tenant.controller.ts',
    'utf8',
  );
  const global = await readFile(
    'src/modules/integrations/integration-credential-global.controller.ts',
    'utf8',
  );
  assert.match(tenant, /@Roles\('OWNER'\)/);
  assert.match(global, /@Roles\('SUPER_ADMIN'\)/);
  for (const source of [tenant, global]) {
    assert.doesNotMatch(source, /secretReference/);
    assert.doesNotMatch(source, /@Get\([^)]*secret/i);
    assert.match(source, /:id\/rotate/);
    assert.match(source, /:id\/verify/);
    assert.match(source, /:id\/revoke/);
  }
});

test('C6 DTO accepts secret only write-side and never models a secret response', async () => {
  const dto = await readFile(
    'src/modules/integrations/dto/integration-credential-admin.dto.ts',
    'utf8',
  );
  assert.match(dto, /secret!:/);
  assert.doesNotMatch(dto, /SecretResponse|ReadSecret|GetSecret/);
});
