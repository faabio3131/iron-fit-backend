import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  IntegrationOAuthScopePolicyService,
} = require(
  '../dist/src/modules/integrations/integration-oauth-scope-policy.service.js',
);

function providerRegistry() {
  return {
    require: (providerCode) => ({
      code: providerCode,
      supportsOAuth: true,
      authModels: ['OAUTH2'],
      environments: ['DEV', 'HOMOLOG', 'PROD'],
      capabilities:
        providerCode === 'meta'
          ? ['meta.facebook', 'meta.instagram', 'meta.whatsapp']
          : ['google.oauth'],
    }),
  };
}

test('I7 approved scope policy returns only exact reviewed scopes', async () => {
  const prisma = {
    integrationOAuthScopePolicy: {
      findMany: async () => [
        {
          id: 'policy-a',
          providerCode: 'meta',
          environment: 'HOMOLOG',
          capability: 'meta.whatsapp',
          status: 'APPROVED',
          scopes: ['whatsapp_business_messaging'],
        },
      ],
    },
  };
  const service = new IntegrationOAuthScopePolicyService(
    prisma,
    {},
    providerRegistry(),
    {},
  );

  const scopes = await service.assertApprovedScopes(
    'meta',
    'HOMOLOG',
    ['meta.whatsapp'],
    {
      'meta.whatsapp': ['whatsapp_business_messaging'],
    },
  );

  assert.deepEqual(scopes, ['whatsapp_business_messaging']);
});

test('I7 fails closed when a capability has no APPROVED policy', async () => {
  const service = new IntegrationOAuthScopePolicyService(
    {
      integrationOAuthScopePolicy: {
        findMany: async () => [],
      },
    },
    {},
    providerRegistry(),
    {},
  );

  await assert.rejects(
    () =>
      service.assertApprovedScopes(
        'google',
        'HOMOLOG',
        ['google.oauth'],
        {
          'google.oauth': [
            'https://www.googleapis.com/auth/example.readonly',
          ],
        },
      ),
    /sem politica de scopes APPROVED/,
  );
});

test('I7 rejects OAuth App configuration broader or different from approved policy', async () => {
  const service = new IntegrationOAuthScopePolicyService(
    {
      integrationOAuthScopePolicy: {
        findMany: async () => [
          {
            id: 'policy-a',
            providerCode: 'meta',
            environment: 'HOMOLOG',
            capability: 'meta.whatsapp',
            status: 'APPROVED',
            scopes: ['scope.minimum'],
          },
        ],
      },
    },
    {},
    providerRegistry(),
    {},
  );

  await assert.rejects(
    () =>
      service.assertApprovedScopes(
        'meta',
        'HOMOLOG',
        ['meta.whatsapp'],
        {
          'meta.whatsapp': ['scope.minimum', 'scope.extra'],
        },
      ),
    /divergem da politica APPROVED/,
  );
});

test('I7 approval retires previous authority and promotes one reviewed policy atomically', async () => {
  const policy = {
    id: 'policy-new',
    providerCode: 'meta',
    environment: 'HOMOLOG',
    capability: 'meta.whatsapp',
    version: 2,
    status: 'DRAFT',
    scopes: ['scope.minimum'],
  };
  const updates = [];
  const audits = [];
  const tx = {
    integrationOAuthScopePolicy: {
      findUnique: async () => policy,
      updateMany: async (args) => {
        updates.push(args);
        return { count: 1 };
      },
    },
  };
  const service = new IntegrationOAuthScopePolicyService(
    {
      $transaction: async (callback, options) => {
        assert.equal(options.isolationLevel, 'Serializable');
        return callback(tx);
      },
    },
    { assertStepUp: async () => undefined },
    providerRegistry(),
    {
      record: async (record, db) => {
        assert.equal(db, tx);
        audits.push(record);
      },
    },
  );

  const result = await service.approve(
    policy.id,
    'super-admin-a',
    { currentPassword: 'StrongPassword123!' },
  );

  assert.equal(result, policy);
  assert.equal(updates.length, 2);
  assert.equal(updates[0].where.status, 'APPROVED');
  assert.equal(updates[0].data.status, 'RETIRED');
  assert.equal(updates[1].where.id, policy.id);
  assert.equal(updates[1].data.status, 'APPROVED');
  assert.equal(updates[1].data.reviewedByUserId, 'super-admin-a');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'INTEGRATION_OAUTH_SCOPE_POLICY_APPROVED');
});

test('I7 policy authority is SUPER_ADMIN + step-up and OAuth core consumes it', async () => {
  const [controller, service, core, migration] = await Promise.all([
    readFile(
      'src/modules/integrations/integration-oauth-scope-policy.controller.ts',
      'utf8',
    ),
    readFile(
      'src/modules/integrations/integration-oauth-scope-policy.service.ts',
      'utf8',
    ),
    readFile(
      'src/modules/integrations/integration-oauth-core.service.ts',
      'utf8',
    ),
    readFile(
      'prisma/migrations/20260928115000_oauth_scope_policy/migration.sql',
      'utf8',
    ),
  ]);

  assert.match(controller, /@Roles\('SUPER_ADMIN'\)/);
  assert.match(service, /assertStepUp/);
  assert.match(service, /Serializable/);
  assert.match(core, /scopePolicies\.assertApprovedScopes/);
  assert.doesNotMatch(core, /scopesForCapabilities/);
  assert.match(
    migration,
    /IntegrationOAuthScopePolicy_one_approved_per_capability/,
  );
  assert.match(migration, /WHERE "status" = 'APPROVED'/);
  assert.doesNotMatch(
    migration,
    /whatsapp_business_messaging|instagram|facebook|googleapis/,
  );
});
