import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

function descriptor() {
  return {
    providerCode: 'example_pay',
    capabilities: ['payments.charge'],
    authModels: ['API_KEY'],
    environments: ['HOMOLOG'],
    supportsWebhook: true,
    supportsOAuth: false,
    tenantEntitlementFeatureKey: 'integration.example_pay',
  };
}

function connection(overrides = {}) {
  return {
    id: 'connection-a',
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

test('C6 admin controller never accepts gymId or environment from tenant payload', async () => {
  const dto = await readFile('src/modules/integrations/dto/integration-admin.dto.ts', 'utf8');
  const controller = await readFile('src/modules/integrations/integration-admin.controller.ts', 'utf8');
  assert.equal(dto.includes('gymId'), false);
  assert.equal(dto.includes('environment'), false);
  assert.match(controller, /activeGymId/);
  assert.match(controller, /@Roles\('OWNER'\)/);
  assert.match(controller, /@Roles\('SUPER_ADMIN'\)/);
});

test('C7 every secret mutation and provider test calls assertStepUp first', async () => {
  const source = await readFile('src/modules/integrations/integration-secret-admin.service.ts', 'utf8');
  for (const marker of [
    'async create(',
    'private async replaceInternal(',
    'async test(',
    'async revoke(',
  ]) {
    const index = source.indexOf(marker);
    assert.ok(index >= 0);
    const section = source.slice(index, index + 1600);
    assert.match(section, /assertStepUp/);
  }
});

test('C6 safe response omits secretReference and raw secret value', async () => {
  const source = await readFile('src/modules/integrations/integration-secret-admin.service.ts', 'utf8');
  const safeStart = source.indexOf('private safeView');
  const safeEnd = source.indexOf('private async assertStepUp', safeStart);
  const safe = source.slice(safeStart, safeEnd);
  assert.doesNotMatch(safe, /secretReference:/);
  assert.doesNotMatch(safe, /secretValue/);
  assert.match(safe, /credentialConfigured/);
});

test('C6 tenant provider requires an enabled commercial entitlement', async () => {
  const source = await readFile('src/modules/integrations/integration-secret-admin.service.ts', 'utf8');
  assert.match(source, /tenantEntitlementFeatureKey/);
  assert.match(source, /resolveFeature\(gymId, featureKey\)/);
  assert.match(source, /resolution\.value !== true/);
});

test('C8 rotation writes a new opaque reference before switching canonical DB pointer', async () => {
  const { IntegrationSecretAdminService } = require(
    '../dist/src/modules/integrations/integration-secret-admin.service.js',
  );

  const old = connection();
  let current = { ...old };
  const calls = [];
  const prisma = {
    integrationConnection: {
      findFirst: async () => current,
      updateMany: async ({ where, data }) => {
        if (
          where.id === current.id &&
          where.secretReference === current.secretReference &&
          where.secretVersion === current.secretVersion
        ) {
          current = { ...current, ...data };
          return { count: 1 };
        }
        return { count: 0 };
      },
      findUnique: async () => current,
    },
    $transaction: async (fn) => fn(prisma),
  };
  const vault = {
    putSecret: async ({ reference, value }) => {
      calls.push(['put', reference, value]);
      return { version: 1, expiresAt: null };
    },
    revokeSecret: async (reference) => {
      calls.push(['revoke', reference]);
    },
  };
  const service = new IntegrationSecretAdminService(
    prisma,
    { record: async () => ({}) },
    { assertStepUp: async () => ({}) },
    {},
    { require: () => descriptor() },
    {},
    { current: () => 'HOMOLOG' },
    { resolveFeature: async () => ({ kind: 'FEATURE', value: true }) },
    {},
    vault,
  );

  const result = await service.rotate(
    'connection-a',
    { userId: 'user-a', scope: { scope: 'TENANT', gymId: 'gym-a' } },
    { secretValue: 'new-secret', currentPassword: 'strong-pass' },
  );

  assert.equal(calls[0][0], 'put');
  assert.notEqual(calls[0][1], old.secretReference);
  assert.equal(calls[1][0], 'revoke');
  assert.equal(calls[1][1], old.secretReference);
  assert.equal(result.credentialConfigured, true);
  assert.equal('secretReference' in result, false);
});

test('C8 revoke disables canonical DB state before physical cleanup and stays fail-closed', async () => {
  const { IntegrationSecretAdminService } = require(
    '../dist/src/modules/integrations/integration-secret-admin.service.js',
  );

  let current = connection();
  const order = [];
  const prisma = {
    integrationConnection: {
      findFirst: async () => current,
      updateMany: async ({ data }) => {
        order.push('db-revoke');
        current = { ...current, ...data };
        return { count: 1 };
      },
      findUnique: async () => current,
    },
    $transaction: async (fn) => fn(prisma),
  };
  const service = new IntegrationSecretAdminService(
    prisma,
    { record: async () => ({}) },
    { assertStepUp: async () => ({}) },
    {},
    { require: () => descriptor() },
    {},
    { current: () => 'HOMOLOG' },
    {},
    {},
    {
      revokeSecret: async () => {
        order.push('physical-revoke');
        throw new Error('OCI unavailable');
      },
    },
  );

  const result = await service.revoke(
    'connection-a',
    { userId: 'user-a', scope: { scope: 'TENANT', gymId: 'gym-a' } },
    { currentPassword: 'strong-pass' },
  );
  assert.deepEqual(order, ['db-revoke', 'physical-revoke']);
  assert.equal(result.credentialConfigured, false);
  assert.equal(result.physicalRevokeScheduled, false);
  assert.equal(current.status, 'DISCONNECTED');
  assert.ok(current.secretRevokedAt);
});

test('C6 provider credential test requires a registered provider-specific probe', async () => {
  const { IntegrationCredentialProbeRegistry } = require(
    '../dist/src/modules/integrations/provider-credential-probe.registry.js',
  );
  const registry = new IntegrationCredentialProbeRegistry();
  assert.throws(() => registry.require('example_pay'), /probe nao configurado/);

  let verified = false;
  registry.register('example_pay', {
    verify: async ({ secret }) => {
      verified = secret.reveal() === 'provider-secret';
    },
  });
  const probe = registry.require('example_pay');
  const { IntegrationSecretValue } = require(
    '../dist/src/modules/integrations/secrets/integration-secret-vault.port.js',
  );
  await probe.verify({
    providerCode: 'example_pay',
    authModel: 'API_KEY',
    capabilities: ['payments.charge'],
    publicConfiguration: null,
    secret: new IntegrationSecretValue('provider-secret'),
  });
  assert.equal(verified, true);
});

test('C9 audit sanitizer treats secretValue as sensitive material', () => {
  const { sanitizeAuditValue } = require('../dist/src/common/audit/audit.service.js');
  const sanitized = sanitizeAuditValue({
    secretValue: 'must-not-leak',
    nested: { clientSecret: 'also-secret' },
  });
  assert.equal(sanitized.secretValue, '[REDACTED]');
  assert.equal(sanitized.nested.clientSecret, '[REDACTED]');
});
