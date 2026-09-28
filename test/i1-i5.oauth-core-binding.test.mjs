import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

function providerRegistry() {
  const { IntegrationProviderRegistry } = require(
    '../dist/src/modules/integrations/provider-registry.service.js',
  );
  const { IntegrationProviderBootstrapService } = require(
    '../dist/src/modules/integrations/integration-provider-bootstrap.service.js',
  );
  const registry = new IntegrationProviderRegistry();
  new IntegrationProviderBootstrapService(registry).onModuleInit();
  return registry;
}

function fixture() {
  const { IntegrationOAuthCoreService } = require(
    '../dist/src/modules/integrations/integration-oauth-core.service.js',
  );

  const now = Date.now();
  const appConnection = {
    id: 'app-meta',
    scope: 'GLOBAL',
    gymId: null,
    providerCode: 'meta',
    environment: 'HOMOLOG',
    authModel: 'OAUTH2',
    status: 'ACTIVE',
    secretReference: 'isv_' + 'A'.repeat(43),
    secretVersion: 1,
    secretRevokedAt: null,
    secretExpiresAt: null,
    updatedAt: new Date(now),
    publicConfiguration: {
      clientId: 'meta-client-id',
      authorizationEndpoint: 'https://oauth.example.com/authorize',
      redirectUris: ['https://iron.example.com/api/v1/integrations/oauth/meta/callback'],
      capabilityScopes: {
        'meta.facebook': ['facebook.scope'],
        'meta.instagram': ['instagram.scope'],
        'meta.whatsapp': ['whatsapp.scope'],
      },
      pkceMode: 'S256',
      authorizationParams: {
        display: 'page',
      },
    },
  };
  const tenantConnection = {
    id: 'tenant-meta',
    scope: 'TENANT',
    gymId: 'gym-a',
    providerCode: 'meta',
    environment: 'HOMOLOG',
    authModel: 'OAUTH2',
    status: 'PENDING',
    capabilities: ['meta.facebook', 'meta.instagram', 'meta.whatsapp'],
    updatedAt: new Date(now),
  };

  let attemptData;
  let pkceValue;
  let stateConsumed = false;
  const auditRecords = [];

  const tx = {
    integrationConnection: {
      findMany: async () => [],
      create: async ({ data }) => ({ ...tenantConnection, ...data }),
    },
    integrationOAuthAuthorizationAttempt: {
      create: async ({ data }) => {
        attemptData = data;
        return { id: 'attempt-a', ...data };
      },
    },
  };

  const prisma = {
    integrationConnection: {
      findFirst: async ({ where }) => {
        if (where.scope === 'GLOBAL') return appConnection;
        return null;
      },
    },
    integrationOAuthAuthorizationAttempt: {
      findUnique: async ({ where }) => {
        if (!attemptData || where.stateHash !== attemptData.stateHash) return null;
        return {
          id: 'attempt-a',
          ...attemptData,
          consumedAt: stateConsumed ? new Date() : null,
          connection: tenantConnection,
        };
      },
      updateMany: async () => {
        if (stateConsumed) return { count: 0 };
        stateConsumed = true;
        return { count: 1 };
      },
    },
    session: {
      findUnique: async () => ({
        id: 'session-a',
        userId: 'owner-a',
        revokedAt: null,
        expiresAt: new Date(now + 60 * 60 * 1000),
        absoluteExpiresAt: new Date(now + 24 * 60 * 60 * 1000),
        createdAt: new Date(now - 1000),
      }),
    },
    userRole: {
      findFirst: async () => ({ id: 'role-owner-a' }),
    },
    $transaction: async (callback, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return callback(tx);
    },
  };

  const vault = {
    putSecret: async ({ value }) => {
      pkceValue = value;
      return { version: 1, expiresAt: null };
    },
    getSecret: async () => ({ value: pkceValue, version: 1, expiresAt: null }),
    inspectSecret: async () => ({ version: 1, expiresAt: null }),
    revokeSecret: async () => undefined,
  };

  const service = new IntegrationOAuthCoreService(
    prisma,
    { assertStepUp: async () => undefined },
    providerRegistry(),
    { current: () => 'HOMOLOG' },
    {
      resolveFeature: async (_gymId, featureKey) => ({
        featureKey,
        kind: 'FEATURE',
        value: true,
      }),
    },
    {
      record: async (record, db) => {
        auditRecords.push({ record, db });
      },
    },
    vault,
  );

  return {
    service,
    appConnection,
    tenantConnection,
    getAttemptData: () => attemptData,
    getPkceValue: () => pkceValue,
    auditRecords,
  };
}

test('I1 start binds OAuth to authenticated tenant/session and stores only state hash + PKCE reference', async () => {
  const fx = fixture();
  const result = await fx.service.startTenantAuthorization(
    { userId: 'owner-a', sessionId: 'session-a', gymId: 'gym-a' },
    'meta',
    {
      currentPassword: 'OwnerPassword123!',
      redirectUri: 'https://iron.example.com/api/v1/integrations/oauth/meta/callback',
      capabilities: ['meta.facebook', 'meta.instagram', 'meta.whatsapp'],
    },
  );

  const url = new URL(result.authorizationUrl);
  const state = url.searchParams.get('state');
  assert.ok(state && state.length >= 43);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'meta-client-id');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.equal(url.searchParams.get('display'), 'page');

  const stored = fx.getAttemptData();
  assert.equal(stored.connectionId, 'tenant-meta');
  assert.equal(stored.appConnectionId, 'app-meta');
  assert.equal(stored.userId, 'owner-a');
  assert.equal(stored.sessionId, 'session-a');
  assert.equal(stored.environment, 'HOMOLOG');
  assert.equal(stored.state, undefined);
  assert.match(stored.stateHash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.stateHash, state);
  assert.equal(stored.pkceVerifier, undefined);
  assert.match(stored.pkceSecretReference, /^isv_[A-Za-z0-9_-]{43}$/);
  assert.equal(typeof fx.getPkceValue(), 'string');
  assert.ok(fx.getPkceValue().length >= 43);
  assert.equal(
    fx.auditRecords.some(({ record }) =>
      JSON.stringify(record).includes(state) ||
      JSON.stringify(record).includes(fx.getPkceValue()),
    ),
    false,
  );
});

test('I5 callback claims canonical tenant/session context without accepting a free tenant id', async () => {
  const fx = fixture();
  const started = await fx.service.startTenantAuthorization(
    { userId: 'owner-a', sessionId: 'session-a', gymId: 'gym-a' },
    'meta',
    {
      currentPassword: 'OwnerPassword123!',
      redirectUri: 'https://iron.example.com/api/v1/integrations/oauth/meta/callback',
    },
  );
  const state = new URL(started.authorizationUrl).searchParams.get('state');

  const claimed = await fx.service.claimCallback(
    'meta',
    state,
    'provider-authorization-code',
  );

  assert.equal(claimed.connectionId, 'tenant-meta');
  assert.equal(claimed.gymId, 'gym-a');
  assert.equal(claimed.userId, 'owner-a');
  assert.equal(claimed.sessionId, 'session-a');
  assert.equal(claimed.authorizationCode.toJSON(), '[REDACTED]');
  assert.equal(claimed.pkceVerifier.toJSON(), '[REDACTED]');
});

test('I5 forged or replayed OAuth state fails closed', async () => {
  const fx = fixture();
  const started = await fx.service.startTenantAuthorization(
    { userId: 'owner-a', sessionId: 'session-a', gymId: 'gym-a' },
    'meta',
    {
      currentPassword: 'OwnerPassword123!',
      redirectUri: 'https://iron.example.com/api/v1/integrations/oauth/meta/callback',
    },
  );
  const state = new URL(started.authorizationUrl).searchParams.get('state');

  await assert.rejects(
    () => fx.service.claimCallback('meta', 'forged-state-' + 'x'.repeat(40), 'code'),
    /callback invalido|state invalido/,
  );

  await fx.service.claimCallback('meta', state, 'code-a');
  await assert.rejects(
    () => fx.service.claimCallback('meta', state, 'code-b'),
    /callback invalido|ja consumido/,
  );
});

test('I1/I5 persistence and controller do not accept raw tenant or OAuth secret authority', async () => {
  const [migration, schema, controller] = await Promise.all([
    readFile(
      'prisma/migrations/20260928032000_oauth_authorization_attempt/migration.sql',
      'utf8',
    ),
    readFile('prisma/integration-secrets.prisma', 'utf8'),
    readFile(
      'src/modules/integrations/integration-oauth.controller.ts',
      'utf8',
    ),
  ]);

  assert.match(migration, /"stateHash"/);
  assert.doesNotMatch(migration, /"state" TEXT/);
  assert.match(migration, /"pkceSecretReference"/);
  assert.doesNotMatch(migration, /"pkceVerifier"/);
  assert.match(schema, /IntegrationOAuthAuthorizationAttempt/);
  assert.doesNotMatch(controller, /@Body\([^)]*gymId|dto\.gymId/);
  assert.match(controller, /activeGymId/);
  assert.match(controller, /sessionId/);
});
