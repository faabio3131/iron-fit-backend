import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

test('C5 SecretValue refuses accidental string/JSON disclosure', () => {
  const { IntegrationSecretValue } = require('../dist/src/modules/integrations/secrets/integration-secret-vault.port.js');
  const value = new IntegrationSecretValue('super-secret-value');
  assert.equal(String(value), '[REDACTED]');
  assert.equal(JSON.stringify({ value }), '{"value":"[REDACTED]"}');
  assert.equal(value.reveal(), 'super-secret-value');
});

test('C5/C10 resolver binds tenant and runtime environment before Vault access', async () => {
  const { IntegrationSecretResolverService } = require('../dist/src/modules/integrations/secrets/integration-secret-resolver.service.js');

  let vaultReads = 0;
  const vault = {
    getSecret: async () => {
      vaultReads += 1;
      return { value: 'provider-secret', version: 3 };
    },
  };
  const connection = {
    id: 'connection-a',
    scope: 'TENANT',
    gymId: 'gym-a',
    environment: 'HOMOLOG',
    status: 'ACTIVE',
    secretReference: 'isv_' + 'A'.repeat(43),
    secretVersion: 3,
    secretRotatedAt: new Date(Date.now() - 1000),
    secretExpiresAt: null,
    secretRevokedAt: null,
  };
  const prisma = {
    integrationConnection: {
      findFirst: async ({ where }) => (
        where.id === 'connection-a' &&
        where.scope === 'TENANT' &&
        where.gymId === 'gym-a' &&
        where.environment === 'HOMOLOG'
          ? connection
          : null
      ),
      updateMany: async () => ({ count: 1 }),
    },
  };
  const runtime = { current: () => 'HOMOLOG' };
  const service = new IntegrationSecretResolverService(prisma, runtime, vault);

  const resolved = await service.resolveForExternalBoundary(
    'connection-a',
    { scope: 'TENANT', gymId: 'gym-a' },
  );
  assert.equal(resolved.reveal(), 'provider-secret');
  assert.equal(vaultReads, 1);

  await assert.rejects(
    service.resolveForExternalBoundary('connection-a', { scope: 'TENANT', gymId: 'gym-b' }),
    /escopo\/ambiente ativo/,
  );
  assert.equal(vaultReads, 1, 'cross-tenant denial must happen before Vault access');
});

test('C8 resolver fails closed for revoked, expired or version-divergent credentials', async () => {
  const { IntegrationSecretResolverService } = require('../dist/src/modules/integrations/secrets/integration-secret-resolver.service.js');
  const base = {
    id: 'connection-a',
    scope: 'TENANT',
    gymId: 'gym-a',
    environment: 'PROD',
    status: 'ACTIVE',
    secretReference: 'isv_' + 'B'.repeat(43),
    secretVersion: 2,
    secretRotatedAt: new Date(Date.now() - 10_000),
    secretExpiresAt: null,
    secretRevokedAt: null,
  };
  let current = { ...base };
  const prisma = {
    integrationConnection: {
      findFirst: async () => current,
      updateMany: async () => ({ count: 1 }),
    },
  };
  const runtime = { current: () => 'PROD' };
  const vault = { getSecret: async () => ({ value: 'secret', version: 2 }) };
  const service = new IntegrationSecretResolverService(prisma, runtime, vault);

  current = { ...base, secretRevokedAt: new Date() };
  await assert.rejects(
    service.resolveForExternalBoundary('connection-a', { scope: 'TENANT', gymId: 'gym-a' }),
    /revogada/,
  );

  current = { ...base, secretExpiresAt: new Date(Date.now() - 1) };
  await assert.rejects(
    service.resolveForExternalBoundary('connection-a', { scope: 'TENANT', gymId: 'gym-a' }),
    /expirada/,
  );

  current = { ...base };
  const divergent = new IntegrationSecretResolverService(
    prisma,
    runtime,
    { getSecret: async () => ({ value: 'secret', version: 9 }) },
  );
  await assert.rejects(
    divergent.resolveForExternalBoundary('connection-a', { scope: 'TENANT', gymId: 'gym-a' }),
    /Versao do segredo diverge/,
  );
});

test('C9 audit redaction catches future secret/card key variants recursively', () => {
  const { sanitizeAuditValue } = require('../dist/src/common/audit/audit.service.js');
  const sanitized = sanitizeAuditValue({
    clientSecret: 'a',
    api_key: 'b',
    nested: {
      access_token: 'c',
      privateKey: 'd',
      cardNumber: '4111111111111111',
      cvv: '123',
      secretReference: 'isv_internal',
      merchantId: 'public',
    },
  });
  assert.equal(sanitized.clientSecret, '[REDACTED]');
  assert.equal(sanitized.api_key, '[REDACTED]');
  assert.equal(sanitized.nested.access_token, '[REDACTED]');
  assert.equal(sanitized.nested.privateKey, '[REDACTED]');
  assert.equal(sanitized.nested.cardNumber, '[REDACTED]');
  assert.equal(sanitized.nested.cvv, '[REDACTED]');
  assert.equal(sanitized.nested.secretReference, '[REDACTED]');
  assert.equal(sanitized.nested.merchantId, 'public');
});

test('C10 runtime environment fails closed when not explicitly configured', () => {
  const { IntegrationRuntimeEnvironmentService } = require('../dist/src/modules/integrations/runtime-environment.service.js');
  const valid = new IntegrationRuntimeEnvironmentService({ get: () => 'homolog' });
  assert.equal(valid.current(), 'HOMOLOG');
  const missing = new IntegrationRuntimeEnvironmentService({ get: () => undefined });
  assert.throws(() => missing.current(), /IRON_RUNTIME_ENV/);
  const invalid = new IntegrationRuntimeEnvironmentService({ get: () => 'staging' });
  assert.throws(() => invalid.current(), /IRON_RUNTIME_ENV/);
});

test('C8 migration keeps credential lifecycle metadata in DB, never secret values', async () => {
  const migration = await readFile(
    'prisma/migrations/20260927143000_integration_secret_lifecycle_controls/migration.sql',
    'utf8',
  );
  for (const field of [
    'secretVersion',
    'secretRotatedAt',
    'secretExpiresAt',
    'secretLastUsedAt',
    'secretRevokedAt',
  ]) {
    assert.match(migration, new RegExp(field));
  }
  assert.doesNotMatch(migration, /secretValue|plaintext|ciphertext/i);
});

test('C13 permanent secret scan is wired into CI before application certification', async () => {
  const workflow = await readFile('.github/workflows/iron-s0-quality.yml', 'utf8');
  assert.match(workflow, /Repository secret scan/);
  assert.match(workflow, /node scripts\/secret-scan\.mjs/);
});
