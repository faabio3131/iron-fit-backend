import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  IntegrationOAuthMaintenanceService,
  OAUTH_PROVIDER_REVOKE_PENDING,
} = require(
  '../dist/src/modules/integrations/integration-oauth-maintenance.service.js',
);
const {
  IntegrationOAuthLifecycleService,
} = require(
  '../dist/src/modules/integrations/integration-oauth-lifecycle.service.js',
);
const {
  IntegrationSecretValue,
} = require(
  '../dist/src/modules/integrations/secrets/integration-secret-vault.port.js',
);

function bundle(providerCode = 'google') {
  return JSON.stringify({
    schemaVersion: 1,
    providerCode,
    accessToken: 'access-secret',
    refreshToken: 'refresh-secret',
    tokenType: 'Bearer',
    grantedScopes: ['scope.a'],
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    accessExpiresAt: new Date(Date.now() + 30_000).toISOString(),
  });
}

function tenantConnection(overrides = {}) {
  return {
    id: 'tenant-google',
    scope: 'TENANT',
    gymId: 'gym-a',
    providerCode: 'google',
    environment: 'HOMOLOG',
    authModel: 'OAUTH2',
    status: 'ACTIVE',
    secretReference: 'isv_' + 'T'.repeat(43),
    secretVersion: 1,
    secretRevokedAt: null,
    oauthAppConnectionId: 'app-google',
    oauthAccessExpiresAt: new Date(Date.now() + 30_000),
    oauthGrantedScopes: ['scope.a'],
    oauthRefreshCapable: true,
    oauthRefreshLeaseOwner: null,
    oauthRefreshLeaseUntil: null,
    oauthRefreshRetryAt: null,
    oauthRefreshFailureCount: 0,
    oauthLastRefreshAt: null,
    ...overrides,
  };
}

function appConnection() {
  return {
    id: 'app-google',
    scope: 'GLOBAL',
    gymId: null,
    providerCode: 'google',
    environment: 'HOMOLOG',
    authModel: 'OAUTH2',
    status: 'ACTIVE',
    secretReference: 'isv_' + 'A'.repeat(43),
    secretVersion: 2,
    secretRevokedAt: null,
    publicConfiguration: {
      clientId: 'google-client',
      exchangeEndpoint: 'https://oauth.example.com/token',
      revocationEndpoint: 'https://oauth.example.com/revoke',
      authorizationParams: { access_type: 'offline' },
    },
  };
}

test('I4 refresh coordinator acquires lease, rotates Vault reference and clears retry state', async () => {
  const base = tenantConnection();
  const app = appConnection();
  let leaseOwner;
  let persistedData;
  let vaultPayload;
  const revoked = [];
  const audits = [];

  const prisma = {
    integrationConnection: {
      updateMany: async ({ data }) => {
        leaseOwner = data.oauthRefreshLeaseOwner;
        return { count: 1 };
      },
      findUnique: async ({ where }) =>
        where.id === base.id
          ? { ...base, oauthRefreshLeaseOwner: leaseOwner }
          : app,
    },
    integrationSecretCleanupTask: {
      upsert: async () => ({ id: 'cleanup-a' }),
    },
    $transaction: async (callback, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return callback({
        integrationConnection: {
          updateMany: async ({ data }) => {
            persistedData = data;
            return { count: 1 };
          },
        },
      });
    },
  };

  const adapters = {
    require: () => ({
      refresh: async ({ refreshToken }) => {
        assert.equal(refreshToken.toJSON(), '[REDACTED]');
        return {
          accessToken: new IntegrationSecretValue('access-new'),
          refreshToken,
          tokenType: 'Bearer',
          grantedScopes: ['scope.a'],
          accessExpiresAt: new Date(Date.now() + 3600_000),
        };
      },
    }),
  };
  const audit = {
    record: async (record, tx) => audits.push({ record, tx }),
  };
  const vault = {
    getSecret: async (reference) =>
      reference === base.secretReference
        ? { value: bundle(), version: 1, expiresAt: null }
        : { value: 'global-client-secret', version: 2, expiresAt: null },
    putSecret: async ({ value }) => {
      vaultPayload = value;
      return { version: 1, expiresAt: null };
    },
    revokeSecret: async (reference) => revoked.push(reference),
  };

  const service = new IntegrationOAuthMaintenanceService(
    prisma,
    adapters,
    audit,
    vault,
  );

  const result = await service.refreshOne(base.id);

  assert.equal(result.refreshed, true);
  assert.equal(typeof leaseOwner, 'string');
  assert.ok(leaseOwner.length >= 32);
  assert.match(persistedData.secretReference, /^isv_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(persistedData.secretReference, base.secretReference);
  assert.equal(persistedData.oauthRefreshLeaseOwner, null);
  assert.equal(persistedData.oauthRefreshLeaseUntil, null);
  assert.equal(persistedData.oauthRefreshRetryAt, null);
  assert.equal(persistedData.oauthRefreshFailureCount, 0);
  assert.ok(persistedData.oauthLastRefreshAt instanceof Date);
  assert.ok(revoked.includes(base.secretReference));

  const stored = JSON.parse(vaultPayload);
  assert.equal(stored.accessToken, 'access-new');
  assert.equal(stored.refreshToken, 'refresh-secret');
  assert.doesNotMatch(
    JSON.stringify(persistedData),
    /access-new|refresh-secret|global-client-secret/,
  );
  assert.doesNotMatch(
    JSON.stringify(audits),
    /access-new|refresh-secret|global-client-secret/,
  );
});

test('I4 concurrent refresh that cannot acquire lease exits without touching provider', async () => {
  let providerCalled = false;
  const service = new IntegrationOAuthMaintenanceService(
    {
      integrationConnection: {
        updateMany: async () => ({ count: 0 }),
      },
    },
    {
      require: () => ({
        refresh: async () => {
          providerCalled = true;
          throw new Error('must not run');
        },
      }),
    },
    { record: async () => undefined },
    {},
  );

  const result = await service.refreshOne('connection-a');
  assert.equal(result.refreshed, false);
  assert.equal(result.reason, 'NOT_DUE_OR_LOCKED');
  assert.equal(providerCalled, false);
});

test('I4 failed provider refresh releases lease and schedules governed retry', async () => {
  const base = tenantConnection();
  const app = appConnection();
  let leaseOwner;
  let mainUpdateCalls = 0;
  let failedState;

  const prisma = {
    integrationConnection: {
      updateMany: async ({ data }) => {
        mainUpdateCalls += 1;
        if (mainUpdateCalls === 1) {
          leaseOwner = data.oauthRefreshLeaseOwner;
          return { count: 1 };
        }
        failedState = data;
        return { count: 1 };
      },
      findUnique: async ({ where }) =>
        where.id === base.id
          ? { ...base, oauthRefreshLeaseOwner: leaseOwner }
          : app,
    },
    integrationSecretCleanupTask: {
      upsert: async () => ({ id: 'cleanup-a' }),
    },
  };

  const service = new IntegrationOAuthMaintenanceService(
    prisma,
    {
      require: () => ({
        refresh: async () => {
          throw new Error('provider unavailable');
        },
      }),
    },
    { record: async () => undefined },
    {
      getSecret: async (reference) =>
        reference === base.secretReference
          ? { value: bundle(), version: 1, expiresAt: null }
          : { value: 'global-client-secret', version: 2, expiresAt: null },
    },
  );

  const result = await service.refreshOne(base.id);
  assert.equal(result.refreshed, false);
  assert.equal(result.reason, 'PROVIDER_OR_STATE_FAILURE');
  assert.equal(failedState.status, 'DEGRADED');
  assert.equal(failedState.oauthRefreshLeaseOwner, null);
  assert.equal(failedState.oauthRefreshLeaseUntil, null);
  assert.equal(failedState.oauthRefreshFailureCount, 1);
  assert.ok(failedState.oauthRefreshRetryAt instanceof Date);
});

test('I8 disconnect fails closed immediately and persists provider revoke retry', async () => {
  const connection = tenantConnection();
  const app = appConnection();
  let disconnectedData;
  let cleanupReason;
  let localRevoked = false;

  const prisma = {
    $transaction: async (callback, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return callback({
        integrationConnection: {
          updateMany: async ({ data }) => {
            disconnectedData = data;
            return { count: 1 };
          },
        },
      });
    },
    integrationConnection: {
      findUnique: async ({ where }) =>
        where.id === app.id ? app : connection,
    },
    integrationSecretCleanupTask: {
      findUnique: async () => null,
      upsert: async ({ create }) => {
        cleanupReason = create.reason;
        return { id: 'cleanup-a' };
      },
    },
  };

  const service = new IntegrationOAuthLifecycleService(
    prisma,
    {
      require: () => ({
        revoke: async () => {
          throw new Error('provider unavailable');
        },
      }),
    },
    { record: async () => undefined },
    {
      getSecret: async () => ({
        value: bundle(),
        version: 1,
        expiresAt: null,
      }),
      revokeSecret: async () => {
        localRevoked = true;
      },
    },
  );

  const result = await service.disconnect(
    connection,
    'owner-a',
    'gym-a',
  );

  assert.equal(disconnectedData.status, 'DISCONNECTED');
  assert.ok(disconnectedData.secretRevokedAt instanceof Date);
  assert.equal(disconnectedData.oauthRefreshLeaseOwner, null);
  assert.equal(result.providerRevocation, 'PENDING_RETRY');
  assert.equal(result.physicalRevocation, 'DEFERRED_FOR_PROVIDER_RETRY');
  assert.equal(cleanupReason, OAUTH_PROVIDER_REVOKE_PENDING);
  assert.equal(localRevoked, false);
});

test('I8 provider without revoke support disconnects locally and destroys Vault credential', async () => {
  const connection = tenantConnection({
    id: 'tenant-meta',
    providerCode: 'meta',
    oauthAppConnectionId: 'app-meta',
  });
  const revoked = [];

  const service = new IntegrationOAuthLifecycleService(
    {
      $transaction: async (callback) =>
        callback({
          integrationConnection: {
            updateMany: async () => ({ count: 1 }),
          },
        }),
      integrationSecretCleanupTask: {
        findUnique: async () => null,
        upsert: async () => ({ id: 'cleanup-a' }),
      },
    },
    {
      require: () => ({}),
    },
    { record: async () => undefined },
    {
      revokeSecret: async (reference) => revoked.push(reference),
    },
  );

  const result = await service.disconnect(
    connection,
    'owner-a',
    'gym-a',
  );

  assert.equal(result.providerRevocation, 'UNSUPPORTED');
  assert.equal(result.physicalRevocation, 'COMPLETED');
  assert.deepEqual(revoked, [connection.secretReference]);
});

test('I4/I8 persistence and admin path are token-free and OAuth-aware', async () => {
  const [schema, migration, adminService, maintenance] = await Promise.all([
    readFile('prisma/integration-secrets.prisma', 'utf8'),
    readFile(
      'prisma/migrations/20260928103500_oauth_refresh_coordination/migration.sql',
      'utf8',
    ),
    readFile(
      'src/modules/integrations/integration-credential-admin.service.ts',
      'utf8',
    ),
    readFile(
      'src/modules/integrations/integration-oauth-maintenance.service.ts',
      'utf8',
    ),
  ]);

  assert.match(schema, /oauthRefreshLeaseOwner/);
  assert.match(schema, /oauthRefreshRetryAt/);
  assert.match(schema, /oauthRefreshFailureCount/);
  assert.match(migration, /oauthRefreshLeaseUntil/);
  assert.doesNotMatch(migration, /accessToken|refreshToken|clientSecret/);
  assert.match(adminService, /connection\.authModel === 'OAUTH2'/);
  assert.match(adminService, /oauthLifecycle\.disconnect/);
  assert.match(maintenance, /oauthRefreshLeaseOwner/);
  assert.match(maintenance, /Serializable/);
});
