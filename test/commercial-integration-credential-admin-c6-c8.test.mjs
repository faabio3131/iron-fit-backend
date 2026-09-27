import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const OLD_REF = 'isv_' + 'A'.repeat(43);

function connection(overrides = {}) {
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
    secretReference: OLD_REF,
    secretVersion: 1,
    secretRotatedAt: new Date(),
    secretExpiresAt: null,
    secretLastUsedAt: null,
    secretRevokedAt: null,
    lastVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function provider(overrides = {}) {
  return {
    providerCode: 'example_pay',
    capabilities: ['payments.charge'],
    authModels: ['API_KEY'],
    environments: ['HOMOLOG'],
    supportsWebhook: true,
    supportsOAuth: false,
    tenantEntitlementFeatureKey: 'integration.example_pay',
    ...overrides,
  };
}

function args(overrides = {}) {
  return [
    overrides.prisma ?? { integrationConnection: {} },
    overrides.auth ?? { assertStepUp: async () => ({}) },
    overrides.providers ?? { require: () => provider() },
    overrides.runtime ?? { current: () => 'HOMOLOG' },
    overrides.audit ?? { record: async () => ({}) },
    overrides.entitlements ?? { resolveFeature: async () => ({ kind: 'FEATURE', value: true }) },
    overrides.probes ?? { require: () => ({ verify: async () => undefined }) },
    overrides.vault ?? {},
  ];
}

test('C6 safe list omits physical secret reference and raw material', async () => {
  const { IntegrationCredentialAdminService } = require('../dist/src/modules/integrations/integration-credential-admin.service.js');
  const prisma = { integrationConnection: { findMany: async () => [connection()] } };
  const service = new IntegrationCredentialAdminService(...args({ prisma }));
  const [view] = await service.list({ scope: 'TENANT', gymId: 'gym-a' });
  assert.equal(view.credentialConfigured, true);
  assert.equal(Object.hasOwn(view, 'secretReference'), false);
  assert.equal(JSON.stringify(view).includes('isv_'), false);
});

test('C7 step-up happens before every credential mutation', async () => {
  const { IntegrationCredentialAdminService } = require('../dist/src/modules/integrations/integration-credential-admin.service.js');
  let stepUps = 0;
  let vaultCalls = 0;
  const service = new IntegrationCredentialAdminService(...args({
    auth: { assertStepUp: async () => { stepUps += 1; throw new Error('STEP_UP'); } },
    vault: {
      putSecret: async () => { vaultCalls += 1; },
      getSecret: async () => { vaultCalls += 1; },
      revokeSecret: async () => { vaultCalls += 1; },
    },
  }));
  const scope = { scope: 'TENANT', gymId: 'gym-a' };
  const step = { currentPassword: 'Strong-Pass-2026!' };
  await assert.rejects(service.create(scope, 'u', { ...step, providerCode:'example_pay', authModel:'API_KEY', capabilities:['payments.charge'], secret:'s' }), /STEP_UP/);
  await assert.rejects(service.replace(scope, connection().id, 'u', { ...step, secret:'s' }), /STEP_UP/);
  await assert.rejects(service.rotate(scope, connection().id, 'u', { ...step, secret:'s' }), /STEP_UP/);
  await assert.rejects(service.verify(scope, connection().id, 'u', step), /STEP_UP/);
  await assert.rejects(service.revoke(scope, connection().id, 'u', step), /STEP_UP/);
  assert.equal(stepUps, 5);
  assert.equal(vaultCalls, 0);
});

test('C6 tenant integration is gated by configurable effective plan entitlement', async () => {
  const { IntegrationCredentialAdminService } = require('../dist/src/modules/integrations/integration-credential-admin.service.js');
  let vaultCalls = 0;
  const service = new IntegrationCredentialAdminService(...args({
    entitlements: { resolveFeature: async () => ({ kind:'FEATURE', value:false }) },
    vault: { putSecret: async () => { vaultCalls += 1; } },
  }));
  await assert.rejects(service.create(
    { scope:'TENANT', gymId:'gym-a' }, 'u',
    { currentPassword:'Strong-Pass-2026!', providerCode:'example_pay', authModel:'API_KEY', capabilities:['payments.charge'], secret:'s' },
  ), /nao autoriza esta integracao/);
  assert.equal(vaultCalls, 0);
});

test('C8 rotation writes new opaque reference, swaps canonical pointer, then revokes old reference', async () => {
  const { IntegrationCredentialAdminService } = require('../dist/src/modules/integrations/integration-credential-admin.service.js');
  const old = connection();
  let current = { ...old };
  let whereSeen;
  const order = [];
  const prisma = {
    integrationConnection: { findFirst: async () => old },
    $transaction: async (fn) => fn({
      integrationConnection: {
        updateMany: async ({ where, data }) => { whereSeen = where; order.push('DB_SWAP'); current = { ...current, ...data }; return { count:1 }; },
        findUniqueOrThrow: async () => current,
      },
    }),
  };
  const vault = {
    putSecret: async ({ reference, expectedVersion }) => {
      order.push('PUT_NEW');
      assert.notEqual(reference, OLD_REF);
      assert.equal(expectedVersion, undefined);
      return { version:1, expiresAt:null };
    },
    revokeSecret: async (reference) => order.push(reference === OLD_REF ? 'REVOKE_OLD' : 'REVOKE_NEW'),
  };
  const service = new IntegrationCredentialAdminService(...args({ prisma, vault }));
  const result = await service.rotate(
    { scope:'TENANT', gymId:'gym-a' }, old.id, 'u',
    { currentPassword:'Strong-Pass-2026!', secret:'new-secret' },
  );
  assert.deepEqual(order, ['PUT_NEW','DB_SWAP','REVOKE_OLD']);
  assert.equal(whereSeen.secretReference, OLD_REF);
  assert.equal(whereSeen.secretVersion, 1);
  assert.equal(Object.hasOwn(result, 'secretReference'), false);
});

test('C6 provider verification requires provider probe before lastVerifiedAt update', async () => {
  const { IntegrationCredentialAdminService } = require('../dist/src/modules/integrations/integration-credential-admin.service.js');
  const old = connection();
  let probeCalls = 0;
  let updateCalls = 0;
  const prisma = {
    integrationConnection: { findFirst: async () => old },
    $transaction: async (fn) => fn({
      integrationConnection: { updateMany: async () => { updateCalls += 1; return { count:1 }; } },
    }),
  };
  const service = new IntegrationCredentialAdminService(...args({
    prisma,
    vault: { getSecret: async () => ({ value:'provider-secret', version:1 }) },
    probes: { require: () => ({ verify: async ({ secret }) => { probeCalls += 1; assert.equal(secret.reveal(),'provider-secret'); } }) },
  }));
  const result = await service.verify(
    { scope:'TENANT', gymId:'gym-a' }, old.id, 'u',
    { currentPassword:'Strong-Pass-2026!' },
  );
  assert.equal(probeCalls, 1);
  assert.equal(updateCalls, 1);
  assert.equal(result.verified, true);
});

test('C8 revoke fails closed in DB and persists opaque cleanup retry when physical revoke fails', async () => {
  const { IntegrationCredentialAdminService } = require('../dist/src/modules/integrations/integration-credential-admin.service.js');
  const old = connection();
  const events = [];
  let cleanup;
  const prisma = {
    integrationConnection: { findFirst: async () => old },
    integrationSecretCleanupTask: {
      upsert: async ({ create }) => { cleanup = { id:'cleanup-1', ...create }; events.push('CLEANUP'); return cleanup; },
    },
    $transaction: async (fn) => fn({
      integrationConnection: { updateMany: async () => { events.push('DB'); return { count:1 }; } },
    }),
  };
  const service = new IntegrationCredentialAdminService(...args({
    prisma,
    vault: { revokeSecret: async () => { events.push('VAULT'); throw new Error('offline'); } },
  }));
  const result = await service.revoke(
    { scope:'TENANT', gymId:'gym-a' }, old.id, 'u',
    { currentPassword:'Strong-Pass-2026!' },
  );
  assert.deepEqual(events, ['DB','VAULT','CLEANUP']);
  assert.equal(result.physicalRevocation, 'PENDING_RETRY');
  assert.equal(cleanup.reason, 'REVOKE_PENDING');
  assert.equal(cleanup.secretReference, OLD_REF);
});

test('C6/C8 source keeps environment server-derived and cleanup reference outside AuditLog identifier', async () => {
  const dto = await readFile('src/modules/integrations/dto/integration-credential-admin.dto.ts','utf8');
  const tenant = await readFile('src/modules/integrations/integration-credential-tenant.controller.ts','utf8');
  const global = await readFile('src/modules/integrations/integration-credential-global.controller.ts','utf8');
  const service = await readFile('src/modules/integrations/integration-credential-admin.service.ts','utf8');
  assert.doesNotMatch(dto, /environment!:/);
  for (const source of [tenant, global]) {
    assert.match(source, /:id\/replace/);
    assert.match(source, /:id\/rotate/);
    assert.match(source, /:id\/verify/);
    assert.match(source, /:id\/revoke/);
    assert.doesNotMatch(source, /@Get\([^)]*secret/i);
  }
  const start = service.indexOf('private async recordCleanupPending');
  const end = service.indexOf('private async markCleanupCompleted', start);
  const helper = service.slice(start,end);
  assert.match(helper, /entityId: task\.id/);
  assert.doesNotMatch(helper, /entityId: reference/);
});
