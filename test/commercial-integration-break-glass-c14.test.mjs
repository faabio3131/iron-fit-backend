import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

function connection(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    scope: 'TENANT',
    gymId: 'gym-a',
    providerCode: 'provider-a',
    environment: 'HOMOLOG',
    authModel: 'API_KEY',
    status: 'ACTIVE',
    capabilities: ['payments.charge'],
    publicConfiguration: { merchantId: 'public' },
    secretReference: 'isv_' + 'A'.repeat(43),
    secretVersion: 2,
    secretRotatedAt: new Date(),
    secretExpiresAt: null,
    secretRevokedAt: null,
    ...overrides,
  };
}

function grant(overrides = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    integrationConnectionId: connection().id,
    operation: 'PROVIDER_VERIFY',
    reason: 'Incident response requires provider verification',
    requestedTtlSeconds: 120,
    requestedByUserId: 'admin-a',
    approvedByUserId: null,
    status: 'REQUESTED',
    approvedAt: null,
    expiresAt: null,
    executionStartedAt: null,
    consumedAt: null,
    failedAt: null,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test('C14 break-glass requires MFA-enabled administrator even after password step-up', async () => {
  const { IntegrationBreakGlassService } = require(
    '../dist/src/modules/integrations/integration-break-glass.service.js',
  );
  let dbTouched = false;
  const service = new IntegrationBreakGlassService(
    {
      integrationBreakGlassGrant: {
        updateMany: async () => {
          dbTouched = true;
          return { count: 0 };
        },
      },
    },
    { assertStepUp: async () => ({ mfaEnabled: false }) },
    { current: () => 'HOMOLOG' },
    {},
    { record: async () => ({}) },
    {},
  );

  await assert.rejects(
    service.request('admin-a', {
      currentPassword: 'Strong-Pass-2026!',
      connectionId: connection().id,
      operation: 'PROVIDER_VERIFY',
      reason: 'Incident response requires provider verification',
      ttlSeconds: 120,
    }),
    /MFA habilitado/,
  );
  assert.equal(dbTouched, false);
});

test('C14 requester cannot approve own break-glass request', async () => {
  const { IntegrationBreakGlassService } = require(
    '../dist/src/modules/integrations/integration-break-glass.service.js',
  );
  const service = new IntegrationBreakGlassService(
    {
      integrationBreakGlassGrant: {
        updateMany: async () => ({ count: 0 }),
        findUnique: async () => grant(),
      },
    },
    { assertStepUp: async () => ({ mfaEnabled: true }) },
    { current: () => 'HOMOLOG' },
    {},
    { record: async () => ({}) },
    {},
  );

  await assert.rejects(
    service.approve(grant().id, 'admin-a', {
      currentPassword: 'Strong-Pass-2026!',
      mfaCode: '123456',
      confirmation: 'APPROVE_BREAK_GLASS',
    }),
    /nao pode aprovar o proprio/,
  );
});

test('C14 distinct approver receives short TTL bounded by requested value', async () => {
  const { IntegrationBreakGlassService } = require(
    '../dist/src/modules/integrations/integration-break-glass.service.js',
  );
  const requested = grant({ requestedTtlSeconds: 120 });
  let approvedData;
  const prisma = {
    integrationBreakGlassGrant: {
      updateMany: async ({ data }) => {
        if (data.status === 'EXPIRED') return { count: 0 };
        approvedData = data;
        return { count: 1 };
      },
      findUnique: async () => requested,
      findUniqueOrThrow: async () => ({
        ...requested,
        ...approvedData,
      }),
    },
    integrationConnection: {
      findFirst: async () => connection(),
    },
  };
  const service = new IntegrationBreakGlassService(
    prisma,
    { assertStepUp: async () => ({ mfaEnabled: true }) },
    { current: () => 'HOMOLOG' },
    {},
    { record: async () => ({}) },
    {},
  );

  const before = Date.now();
  const result = await service.approve(requested.id, 'admin-b', {
    currentPassword: 'Strong-Pass-2026!',
    mfaCode: '123456',
    confirmation: 'APPROVE_BREAK_GLASS',
  });

  assert.equal(result.approvedByUserId, 'admin-b');
  assert.equal(result.status, 'APPROVED');
  assert.ok(result.expiresAt.getTime() - before >= 119000);
  assert.ok(result.expiresAt.getTime() - before <= 121000);
});

test('C14 execute is server-side, one-time and exposes secret only to registered provider probe', async () => {
  const { IntegrationBreakGlassService } = require(
    '../dist/src/modules/integrations/integration-break-glass.service.js',
  );

  const approved = grant({
    status: 'APPROVED',
    approvedByUserId: 'admin-b',
    approvedAt: new Date(),
    expiresAt: new Date(Date.now() + 120000),
  });
  const conn = connection();
  let probeSecret;
  const grantTransitions = [];
  const rootPrisma = {
    integrationBreakGlassGrant: {
      updateMany: async ({ data }) => {
        if (data.status) grantTransitions.push(data.status);
        return { count: 1 };
      },
      findUnique: async () => approved,
    },
    integrationConnection: {
      findFirst: async () => conn,
      updateMany: async () => ({ count: 1 }),
    },
    $transaction: async (fn) => fn({
      integrationBreakGlassGrant: {
        updateMany: async ({ data }) => {
          grantTransitions.push(data.status);
          return { count: 1 };
        },
      },
      integrationConnection: {
        updateMany: async () => ({ count: 1 }),
      },
    }),
  };

  const service = new IntegrationBreakGlassService(
    rootPrisma,
    { assertStepUp: async () => ({ mfaEnabled: true }) },
    { current: () => 'HOMOLOG' },
    {
      require: () => ({
        verify: async ({ secret }) => {
          probeSecret = secret.reveal();
        },
      }),
    },
    { record: async () => ({}) },
    {
      getSecret: async () => ({
        value: 'physical-provider-secret',
        version: 2,
        expiresAt: null,
      }),
    },
  );

  const result = await service.execute(approved.id, 'admin-a', {
    currentPassword: 'Strong-Pass-2026!',
    mfaCode: '123456',
    confirmation: 'EXECUTE_BREAK_GLASS',
  });

  assert.equal(probeSecret, 'physical-provider-secret');
  assert.deepEqual(grantTransitions, ['EXECUTING', 'CONSUMED']);
  assert.equal(result.status, 'CONSUMED');
  assert.equal(result.executed, true);
  assert.equal(JSON.stringify(result).includes('physical-provider-secret'), false);
  assert.equal(JSON.stringify(result).includes('isv_'), false);
});

test('C14 provider failure makes grant terminal FAILED instead of reusable', async () => {
  const { IntegrationBreakGlassService } = require(
    '../dist/src/modules/integrations/integration-break-glass.service.js',
  );
  const approved = grant({
    status: 'APPROVED',
    approvedByUserId: 'admin-b',
    expiresAt: new Date(Date.now() + 120000),
  });
  const transitions = [];
  const prisma = {
    integrationBreakGlassGrant: {
      updateMany: async ({ data }) => {
        if (data.status) transitions.push(data.status);
        return { count: 1 };
      },
      findUnique: async () => approved,
    },
    integrationConnection: {
      findFirst: async () => connection(),
      updateMany: async () => ({ count: 1 }),
    },
  };
  const service = new IntegrationBreakGlassService(
    prisma,
    { assertStepUp: async () => ({ mfaEnabled: true }) },
    { current: () => 'HOMOLOG' },
    {
      require: () => ({
        verify: async () => {
          throw new Error('provider offline');
        },
      }),
    },
    { record: async () => ({}) },
    {
      getSecret: async () => ({
        value: 'physical-provider-secret',
        version: 2,
        expiresAt: null,
      }),
    },
  );

  await assert.rejects(
    service.execute(approved.id, 'admin-a', {
      currentPassword: 'Strong-Pass-2026!',
      mfaCode: '123456',
      confirmation: 'EXECUTE_BREAK_GLASS',
    }),
    /provider offline/,
  );

  assert.deepEqual(transitions, ['EXECUTING', 'FAILED']);
});

test('C14 rejects likely secret material in human justification', async () => {
  const { IntegrationBreakGlassService } = require(
    '../dist/src/modules/integrations/integration-break-glass.service.js',
  );
  let connectionRead = false;
  const service = new IntegrationBreakGlassService(
    {
      integrationBreakGlassGrant: {
        updateMany: async () => ({ count: 0 }),
      },
      integrationConnection: {
        findFirst: async () => {
          connectionRead = true;
          return connection();
        },
      },
    },
    { assertStepUp: async () => ({ mfaEnabled: true }) },
    { current: () => 'HOMOLOG' },
    {},
    { record: async () => ({}) },
    {},
  );

  await assert.rejects(
    service.request('admin-a', {
      currentPassword: 'Strong-Pass-2026!',
      mfaCode: '123456',
      connectionId: connection().id,
      operation: 'PROVIDER_VERIFY',
      reason: 'Incident requires token=super-secret-value for diagnosis',
      ttlSeconds: 120,
    }),
    /nao pode conter credenciais/,
  );
  assert.equal(connectionRead, false);
});

test('C14 approved grants expire and no controller exposes secret reveal/read', async () => {
  const controller = await readFile(
    'src/modules/integrations/integration-break-glass.controller.ts',
    'utf8',
  );
  const schema = await readFile('prisma/integration-secrets.prisma', 'utf8');
  const migration = await readFile(
    'prisma/migrations/20260927203500_c14_governed_break_glass/migration.sql',
    'utf8',
  );

  assert.match(controller, /@Roles\('SUPER_ADMIN'\)/);
  assert.match(controller, /:id\/approve/);
  assert.match(controller, /:id\/execute/);
  assert.match(controller, /:id\/revoke/);
  assert.doesNotMatch(controller, /reveal|secretReference|plaintext|getSecret/i);

  const start = schema.indexOf('model IntegrationBreakGlassGrant');
  const block = schema.slice(start);
  assert.doesNotMatch(block, /secretReference|secretValue|apiKey|accessToken/);
  assert.match(block, /requestedTtlSeconds/);
  assert.match(migration, /BETWEEN 60 AND 900/);
  assert.match(migration, /approvedByUserId.*requestedByUserId/s);
});

test('C14 code has no generic arbitrary break-glass operation executor', async () => {
  const service = await readFile(
    'src/modules/integrations/integration-break-glass.service.ts',
    'utf8',
  );
  const dto = await readFile(
    'src/modules/integrations/dto/integration-break-glass.dto.ts',
    'utf8',
  );

  assert.match(dto, /PROVIDER_VERIFY/);
  assert.doesNotMatch(dto, /COMMAND|SHELL|RAW_SECRET|READ_SECRET/);
  assert.match(service, /IntegrationBreakGlassOperation\.PROVIDER_VERIFY/);
  assert.doesNotMatch(service, /eval\(|exec\(|spawn\(/);
});
