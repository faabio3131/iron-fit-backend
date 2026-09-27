import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

function row(overrides = {}) {
  return {
    id: 'connection-a',
    scope: 'TENANT',
    gymId: 'gym-a',
    providerCode: 'provider-a',
    environment: 'HOMOLOG',
    status: 'ACTIVE',
    secretReference: 'isv_' + 'A'.repeat(43),
    secretVersion: 2,
    secretRotatedAt: new Date('2026-09-27T10:00:00.000Z'),
    secretExpiresAt: null,
    secretRevokedAt: null,
    ...overrides,
  };
}

test('C11 removes legacy gateway credential material from canonical PostgreSQL schema with fail-safe migration guard', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  const migration = await readFile(
    'prisma/migrations/20260927201500_c11_secret_backup_dr_boundary/migration.sql',
    'utf8',
  );

  const start = schema.indexOf('model GatewayConnection');
  const end = schema.indexOf('model FinancialAccount', start);
  const gateway = schema.slice(start, end);

  for (const field of [
    'apiKeyEnc',
    'accessTokenEnc',
    'refreshTokenEnc',
    'webhookSecretEnc',
  ]) {
    assert.equal(gateway.includes(field), false);
    assert.match(migration, new RegExp('"' + field + '"'));
  }

  assert.match(migration, /RAISE EXCEPTION/);
  assert.match(migration, /externalized to Integration Secret Vault/);
  assert.match(migration, /DROP COLUMN IF EXISTS/);
});

test('C11 Vault metadata inspection contract never returns reusable secret value', async () => {
  const port = await readFile(
    'src/modules/integrations/secrets/integration-secret-vault.port.ts',
    'utf8',
  );
  const oci = await readFile(
    'src/modules/integrations/secrets/oci/oci-integration-secret-vault.adapter.ts',
    'utf8',
  );

  const metadataStart = port.indexOf('export interface VaultSecretMetadata');
  const snapshotStart = port.indexOf('export interface VaultSecretSnapshot');
  const metadata = port.slice(metadataStart, snapshotStart);
  assert.match(metadata, /version: number/);
  assert.doesNotMatch(metadata, /value:/);

  const inspectStart = oci.indexOf('async inspectSecret');
  const revokeStart = oci.indexOf('async revokeSecret', inspectStart);
  const inspect = oci.slice(inspectStart, revokeStart);
  assert.match(inspect, /this\.current\(reference\)/);
  assert.doesNotMatch(inspect, /this\.decode/);
});

test('C11 DR assessment exposes only safe metadata and identifies physical version mismatch', async () => {
  const { IntegrationSecretDrService } = require(
    '../dist/src/modules/integrations/integration-secret-dr.service.js',
  );

  const rows = [
    row(),
    row({
      id: 'connection-b',
      providerCode: 'provider-b',
      secretReference: 'isv_' + 'B'.repeat(43),
      secretVersion: 7,
    }),
  ];

  const service = new IntegrationSecretDrService(
    { integrationConnection: { findMany: async () => rows } },
    { assertStepUp: async () => ({}) },
    { current: () => 'HOMOLOG' },
    { record: async () => ({}) },
    {
      inspectSecret: async (reference) => ({
        version: reference.includes('BBBB') ? 8 : 2,
        expiresAt: null,
      }),
    },
  );

  const result = await service.assess('admin-a', {
    currentPassword: 'Strong-Pass-2026!',
  });

  assert.equal(result.environment, 'HOMOLOG');
  assert.equal(result.counts.AVAILABLE, 1);
  assert.equal(result.counts.VERSION_MISMATCH, 1);
  assert.equal(JSON.stringify(result).includes('isv_'), false);
  assert.equal(JSON.stringify(result).includes('provider-secret'), false);
});

test('C11 fail-closed reconcile only reduces authority of unverified ACTIVE connections', async () => {
  const { IntegrationSecretDrService } = require(
    '../dist/src/modules/integrations/integration-secret-dr.service.js',
  );

  const rows = [
    row({ id: 'healthy', secretReference: 'isv_' + 'H'.repeat(43) }),
    row({
      id: 'mismatch',
      secretReference: 'isv_' + 'M'.repeat(43),
      secretVersion: 3,
    }),
    row({
      id: 'already-degraded',
      status: 'DEGRADED',
      secretReference: 'isv_' + 'D'.repeat(43),
      secretVersion: 5,
    }),
  ];

  const changes = [];
  const prisma = {
    integrationConnection: {
      findMany: async () => rows,
      updateMany: async ({ where, data }) => {
        changes.push({ where, data });
        return { count: where.id === 'mismatch' ? 1 : 0 };
      },
    },
  };

  const service = new IntegrationSecretDrService(
    prisma,
    { assertStepUp: async () => ({}) },
    { current: () => 'HOMOLOG' },
    { record: async () => ({}) },
    {
      inspectSecret: async (reference) => {
        if (reference.includes('HHHH')) return { version: 2, expiresAt: null };
        if (reference.includes('MMMM')) return { version: 4, expiresAt: null };
        throw new Error('vault unavailable');
      },
    },
  );

  const result = await service.reconcileFailClosed('admin-a', {
    currentPassword: 'Strong-Pass-2026!',
    confirmation: 'MARK_UNVERIFIED_CONNECTIONS_DEGRADED',
  });

  assert.equal(result.changedToDegraded, 1);
  assert.ok(changes.every((entry) => entry.data.status === 'DEGRADED'));
  assert.ok(changes.every((entry) => entry.data.lastVerifiedAt === null));
  assert.equal(changes.some((entry) => entry.where.id === 'healthy'), false);
  assert.match(result.recoveryRule, /never reconstructs secret values/);
});

test('C11 DB-only restored metadata cannot resolve a credential without physical Vault', async () => {
  const {
    IntegrationSecretResolverService,
  } = require(
    '../dist/src/modules/integrations/secrets/integration-secret-resolver.service.js',
  );
  const {
    UnavailableIntegrationSecretVaultAdapter,
  } = require(
    '../dist/src/modules/integrations/secrets/unavailable-integration-secret-vault.adapter.js',
  );

  const restored = row({
    scope: 'GLOBAL',
    gymId: null,
    providerCode: 'dr-restored',
  });

  const resolver = new IntegrationSecretResolverService(
    {
      integrationConnection: {
        findFirst: async () => restored,
        updateMany: async () => ({ count: 1 }),
      },
    },
    { current: () => 'HOMOLOG' },
    new UnavailableIntegrationSecretVaultAdapter(),
  );

  await assert.rejects(
    resolver.resolveForExternalBoundary(restored.id, { scope: 'GLOBAL' }),
    /Vault fisico nao configurado/,
  );
});

test('C11 recovery endpoints are SUPER_ADMIN-only, step-up governed and have no environment selector', async () => {
  const controller = await readFile(
    'src/modules/integrations/integration-secret-dr.controller.ts',
    'utf8',
  );
  const dto = await readFile(
    'src/modules/integrations/dto/integration-dr.dto.ts',
    'utf8',
  );
  const service = await readFile(
    'src/modules/integrations/integration-secret-dr.service.ts',
    'utf8',
  );

  assert.match(controller, /@Roles\('SUPER_ADMIN'\)/);
  assert.match(controller, /reconcile-fail-closed/);
  assert.doesNotMatch(dto, /environment/);
  assert.match(service, /authSecurity\.assertStepUp/);
  assert.match(service, /runtime\.current\(\)/);
  assert.doesNotMatch(controller, /secretReference|secretValue|plaintext/);
});

test('C11 CI runs a real PostgreSQL dump/restore boundary drill', async () => {
  const workflow = await readFile(
    '.github/workflows/iron-s0-quality.yml',
    'utf8',
  );
  assert.match(workflow, /C11 PostgreSQL backup\/restore secret boundary drill/);
  assert.match(workflow, /pg_dump/);
  assert.match(workflow, /iron_c11_restore/);
  assert.match(workflow, /c11-dr-restore-verify\.mjs/);
  assert.match(workflow, /apiKeyEnc/);
});
