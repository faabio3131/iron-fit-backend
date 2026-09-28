import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

test('I2/I3 adapters exchange authorization code without exposing token values in returned JSON', async () => {
  const {
    GoogleOAuthProviderAdapter,
  } = require(
    '../dist/src/modules/integrations/integration-oauth-provider.adapter.js',
  );
  const {
    IntegrationSecretValue,
  } = require(
    '../dist/src/modules/integrations/secrets/integration-secret-vault.port.js',
  );

  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(
      JSON.stringify({
        access_token: 'provider-access-secret',
        refresh_token: 'provider-refresh-secret',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'scope.a scope.b',
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  };

  try {
    const adapter = new GoogleOAuthProviderAdapter();
    const bundle = await adapter.exchangeCode({
      providerCode: 'google',
      publicConfiguration: {
        clientId: 'google-client-id',
        tokenEndpoint: 'https://oauth.example.com/token',
        revocationEndpoint: 'https://oauth.example.com/revoke',
        clientAuthMode: 'BODY',
        refreshMode: 'REFRESH_TOKEN',
      },
      clientSecret: new IntegrationSecretValue('global-client-secret'),
      authorizationCode: new IntegrationSecretValue('authorization-code'),
      redirectUri: 'https://iron.example.com/api/v1/integrations/oauth/google/callback',
      pkceVerifier: new IntegrationSecretValue('pkce-verifier'),
      requestedScopes: ['scope.a', 'scope.b'],
    });

    assert.equal(request.url, 'https://oauth.example.com/token');
    const body = String(request.options.body);
    assert.match(body, /grant_type=authorization_code/);
    assert.match(body, /client_id=google-client-id/);
    assert.match(body, /client_secret=global-client-secret/);
    assert.match(body, /code=authorization-code/);
    assert.match(body, /code_verifier=pkce-verifier/);

    assert.equal(bundle.accessToken.toJSON(), '[REDACTED]');
    assert.equal(bundle.refreshToken.toJSON(), '[REDACTED]');
    assert.equal(bundle.tokenType, 'Bearer');
    assert.deepEqual(bundle.grantedScopes, ['scope.a', 'scope.b']);
    assert.ok(bundle.accessTokenExpiresAt instanceof Date);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('I2/I3 provider configuration rejects non-HTTPS token endpoints and reserved overrides', async () => {
  const {
    parseOAuthProviderConfiguration,
  } = require(
    '../dist/src/modules/integrations/integration-oauth-provider.adapter.js',
  );

  assert.throws(
    () =>
      parseOAuthProviderConfiguration({
        clientId: 'x',
        tokenEndpoint: 'http://localhost/token',
        clientAuthMode: 'BODY',
        refreshMode: 'REFRESH_TOKEN',
      }),
    /HTTPS|host proibido/,
  );

  assert.throws(
    () =>
      parseOAuthProviderConfiguration({
        clientId: 'x',
        tokenEndpoint: 'https://oauth.example.com/token',
        clientAuthMode: 'BODY',
        refreshMode: 'REFRESH_TOKEN',
        tokenRequestParams: { client_secret: 'must-not-override' },
      }),
    /parametro reservado/,
  );
});

test('I2/I3 persistence stores OAuth token metadata in PostgreSQL but never access or refresh token columns', async () => {
  const [migration, schema] = await Promise.all([
    readFile(
      'prisma/migrations/20260928034500_oauth_token_state/migration.sql',
      'utf8',
    ),
    readFile('prisma/integration-secrets.prisma', 'utf8'),
  ]);

  assert.match(migration, /IntegrationOAuthTokenState/);
  assert.match(migration, /accessTokenExpiresAt/);
  assert.match(migration, /refreshAvailable/);
  assert.match(migration, /appConnectionId/);
  assert.doesNotMatch(migration, /"accessToken"/);
  assert.doesNotMatch(migration, /"refreshToken"/);
  assert.doesNotMatch(schema, /accessToken\s+String/);
  assert.doesNotMatch(schema, /refreshToken\s+String/);
});

test('I4 refresh coordinator uses persistent lease and Vault expectedVersion CAS', async () => {
  const [coordinator, tokens] = await Promise.all([
    readFile(
      'src/modules/integrations/integration-oauth-refresh-coordinator.service.ts',
      'utf8',
    ),
    readFile(
      'src/modules/integrations/integration-oauth-token.service.ts',
      'utf8',
    ),
  ]);

  assert.match(coordinator, /refreshLeaseHash/);
  assert.match(coordinator, /refreshLeaseUntil/);
  assert.match(coordinator, /updateMany/);
  assert.match(coordinator, /refresh concorrente em andamento/);
  assert.match(tokens, /expectedVersion: expectedSecretVersion/);
  assert.match(tokens, /refreshGeneration: \{ increment: 1 \}/);
  assert.match(tokens, /OAuth connection mudou durante commit do refresh/);
});

test('I2/I3 callback never accepts gymId or tenantId as destination authority', async () => {
  const controller = await readFile(
    'src/modules/integrations/integration-oauth-callback.controller.ts',
    'utf8',
  );
  assert.doesNotMatch(controller, /@Query\(['"]gymId/);
  assert.doesNotMatch(controller, /@Query\(['"]tenantId/);
  assert.match(controller, /state/);
  assert.match(controller, /code/);
  assert.match(controller, /completeCallback/);
});

test('I2/I3 provider authority remains Meta umbrella plus Google, without per-product Meta duplication', async () => {
  const source = await readFile(
    'src/modules/integrations/integration-provider-bootstrap.service.ts',
    'utf8',
  );
  assert.match(source, /providerCode: 'meta'/);
  assert.match(source, /'meta\.facebook'/);
  assert.match(source, /'meta\.instagram'/);
  assert.match(source, /'meta\.whatsapp'/);
  assert.match(source, /providerCode: 'google'/);
  assert.doesNotMatch(source, /providerCode: 'facebook'/);
  assert.doesNotMatch(source, /providerCode: 'instagram'/);
  assert.doesNotMatch(source, /providerCode: 'whatsapp'/);
});
