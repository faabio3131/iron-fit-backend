import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  GoogleOAuthProviderAdapter,
  MetaOAuthProviderAdapter,
} = require(
  '../dist/src/modules/integrations/integration-oauth-provider-adapters.js',
);
const {
  IntegrationOAuthProviderService,
} = require(
  '../dist/src/modules/integrations/integration-oauth-provider.service.js',
);
const {
  IntegrationSecretValue,
} = require(
  '../dist/src/modules/integrations/secrets/integration-secret-vault.port.js',
);

function configuration(overrides = {}) {
  return {
    clientId: 'client-id',
    exchangeEndpoint: 'https://oauth.example.com/token',
    revocationEndpoint: 'https://oauth.example.com/revoke',
    authorizationParams: {},
    ...overrides,
  };
}

test('I2 Meta adapter exchanges authorization code without exposing credentials', async () => {
  const calls = [];
  const http = {
    postForm: async (endpoint, body) => {
      calls.push({ endpoint, body });
      return {
        status: 200,
        payload: {
          access_token: 'meta-access-token',
          token_type: 'bearer',
          expires_in: 3600,
        },
      };
    },
  };

  const adapter = new MetaOAuthProviderAdapter(http);
  const tokenSet = await adapter.exchange({
    configuration: configuration(),
    clientSecret: new IntegrationSecretValue('meta-client-secret'),
    authorizationCode: new IntegrationSecretValue('meta-code'),
    redirectUri: 'https://iron.example.com/api/v1/integrations/oauth/meta/callback',
    requestedScopes: ['meta.scope.a', 'meta.scope.b'],
    pkceVerifier: new IntegrationSecretValue('meta-pkce'),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, 'https://oauth.example.com/token');
  assert.equal(calls[0].body.client_id, 'client-id');
  assert.equal(calls[0].body.client_secret, 'meta-client-secret');
  assert.equal(calls[0].body.code, 'meta-code');
  assert.equal(calls[0].body.code_verifier, 'meta-pkce');
  assert.equal(calls[0].body.grant_type, undefined);
  assert.equal(tokenSet.accessToken.toJSON(), '[REDACTED]');
  assert.equal(tokenSet.refreshToken, null);
  assert.deepEqual(tokenSet.grantedScopes, ['meta.scope.a', 'meta.scope.b']);
  assert.ok(tokenSet.accessExpiresAt instanceof Date);
});

test('I3 Google adapter enforces offline access, exchanges, refreshes and revokes', async () => {
  const calls = [];
  const http = {
    postForm: async (endpoint, body) => {
      calls.push({ endpoint, body });
      if (body.grant_type === 'refresh_token') {
        return {
          status: 200,
          payload: {
            access_token: 'google-access-refreshed',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'scope.a scope.b',
          },
        };
      }
      if (body.token) {
        return { status: 200, payload: {} };
      }
      return {
        status: 200,
        payload: {
          access_token: 'google-access',
          refresh_token: 'google-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'scope.a scope.b',
        },
      };
    },
  };

  const adapter = new GoogleOAuthProviderAdapter(http);
  const cfg = configuration({
    authorizationParams: { access_type: 'offline' },
  });

  const exchanged = await adapter.exchange({
    configuration: cfg,
    clientSecret: new IntegrationSecretValue('google-client-secret'),
    authorizationCode: new IntegrationSecretValue('google-code'),
    redirectUri: 'https://iron.example.com/api/v1/integrations/oauth/google/callback',
    requestedScopes: ['scope.a', 'scope.b'],
    pkceVerifier: new IntegrationSecretValue('google-pkce'),
  });

  assert.equal(calls[0].body.grant_type, 'authorization_code');
  assert.equal(calls[0].body.code_verifier, 'google-pkce');
  assert.equal(exchanged.refreshToken.toJSON(), '[REDACTED]');

  const refreshed = await adapter.refresh({
    configuration: cfg,
    clientSecret: new IntegrationSecretValue('google-client-secret'),
    refreshToken: exchanged.refreshToken,
    requestedScopes: ['scope.a', 'scope.b'],
  });

  assert.equal(calls[1].body.grant_type, 'refresh_token');
  assert.equal(refreshed.accessToken.toJSON(), '[REDACTED]');
  assert.equal(refreshed.refreshToken.toJSON(), '[REDACTED]');

  await adapter.revoke({
    configuration: cfg,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
  });

  assert.equal(calls[2].endpoint, 'https://oauth.example.com/revoke');
  assert.equal(calls[2].body.token, 'google-refresh');

  await assert.rejects(
    () =>
      adapter.exchange({
        configuration: configuration(),
        clientSecret: new IntegrationSecretValue('google-client-secret'),
        authorizationCode: new IntegrationSecretValue('google-code'),
        redirectUri:
          'https://iron.example.com/api/v1/integrations/oauth/google/callback',
        requestedScopes: ['scope.a'],
        pkceVerifier: null,
      }),
    /access_type=offline/,
  );
});

test('I2/I3 callback stores provider tokens only in tenant Vault and persists opaque metadata', async () => {
  const now = Date.now();
  const tenantConnection = {
    id: 'tenant-oauth',
    scope: 'TENANT',
    gymId: 'gym-a',
    providerCode: 'google',
    environment: 'HOMOLOG',
    authModel: 'OAUTH2',
    status: 'PENDING',
    secretReference: null,
    secretVersion: null,
  };
  const appConnection = {
    id: 'app-google',
    scope: 'GLOBAL',
    gymId: null,
    providerCode: 'google',
    environment: 'HOMOLOG',
    authModel: 'OAUTH2',
    status: 'ACTIVE',
    secretReference: 'isv_' + 'A'.repeat(43),
    secretVersion: 4,
    secretRevokedAt: null,
    publicConfiguration: {
      clientId: 'google-client-id',
      exchangeEndpoint: 'https://oauth.example.com/token',
      revocationEndpoint: 'https://oauth.example.com/revoke',
      authorizationParams: { access_type: 'offline' },
    },
  };

  const claimed = {
    providerCode: 'google',
    environment: 'HOMOLOG',
    connectionId: tenantConnection.id,
    appConnectionId: appConnection.id,
    gymId: 'gym-a',
    userId: 'owner-a',
    sessionId: 'session-a',
    redirectUri:
      'https://iron.example.com/api/v1/integrations/oauth/google/callback',
    scopes: ['scope.a'],
    authorizationCode: new IntegrationSecretValue('authorization-code'),
    pkceVerifier: new IntegrationSecretValue('pkce-verifier'),
    pkceSecretReference: 'isv_' + 'P'.repeat(43),
  };

  let persistedData;
  let vaultPayload;
  const revoked = [];
  const audits = [];

  const prisma = {
    integrationConnection: {
      findUnique: async ({ where }) =>
        where.id === tenantConnection.id ? tenantConnection : appConnection,
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

  const oauthCore = {
    claimCallback: async () => claimed,
  };
  const adapters = {
    require: () => ({
      providerCode: 'google',
      exchange: async () => ({
        accessToken: new IntegrationSecretValue('access-secret'),
        refreshToken: new IntegrationSecretValue('refresh-secret'),
        tokenType: 'Bearer',
        grantedScopes: ['scope.a'],
        accessExpiresAt: new Date(now + 3600_000),
      }),
    }),
  };
  const audit = {
    record: async (record, tx) => {
      audits.push({ record, tx });
    },
  };
  const vault = {
    getSecret: async () => ({
      value: 'client-secret',
      version: 4,
      expiresAt: null,
    }),
    putSecret: async ({ value }) => {
      vaultPayload = value;
      return { version: 1, expiresAt: null };
    },
    revokeSecret: async (reference) => {
      revoked.push(reference);
    },
  };

  const service = new IntegrationOAuthProviderService(
    prisma,
    oauthCore,
    adapters,
    audit,
    vault,
  );

  const result = await service.completeCallback(
    'google',
    'state-value-' + 'x'.repeat(40),
    'authorization-code',
  );

  assert.equal(result.connected, true);
  assert.equal(result.connectionId, tenantConnection.id);
  assert.equal(result.refreshCapable, true);
  assert.equal(result.accessToken, undefined);
  assert.equal(result.refreshToken, undefined);

  const bundle = JSON.parse(vaultPayload);
  assert.equal(bundle.accessToken, 'access-secret');
  assert.equal(bundle.refreshToken, 'refresh-secret');
  assert.equal(bundle.providerCode, 'google');

  const persisted = JSON.stringify(persistedData);
  assert.doesNotMatch(persisted, /access-secret|refresh-secret|client-secret/);
  assert.match(persistedData.secretReference, /^isv_[A-Za-z0-9_-]{43}$/);
  assert.equal(persistedData.oauthAppConnectionId, appConnection.id);
  assert.equal(persistedData.oauthRefreshCapable, true);
  assert.deepEqual(persistedData.oauthGrantedScopes, ['scope.a']);
  assert.equal(audits.length, 1);
  assert.doesNotMatch(
    JSON.stringify(audits),
    /access-secret|refresh-secret|client-secret|authorization-code|pkce-verifier/,
  );
  assert.ok(revoked.includes(claimed.pkceSecretReference));
});

test('I2/I3 schema binds tenant OAuth to GLOBAL app without token columns', async () => {
  const [schema, migration, callbackController] = await Promise.all([
    readFile('prisma/integration-secrets.prisma', 'utf8'),
    readFile(
      'prisma/migrations/20260928100000_oauth_provider_binding/migration.sql',
      'utf8',
    ),
    readFile(
      'src/modules/integrations/integration-oauth-callback.controller.ts',
      'utf8',
    ),
  ]);

  assert.match(schema, /oauthAppConnectionId/);
  assert.match(schema, /oauthRefreshCapable/);
  assert.match(migration, /FOREIGN KEY \("oauthAppConnectionId"\)/);
  assert.doesNotMatch(migration, /accessToken|refreshToken|clientSecret/);
  assert.doesNotMatch(callbackController, /gymId|tenantId/);
  assert.match(callbackController, /state/);
  assert.match(callbackController, /code/);
});
