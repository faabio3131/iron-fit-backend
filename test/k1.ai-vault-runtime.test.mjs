import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  AiSecretReferenceService,
} = require(
  '../dist/src/modules/ai/secrets/ai-secret-reference.service.js',
);
const {
  AiProviderExecutionService,
} = require(
  '../dist/src/modules/ai/runtime/ai-provider-execution.service.js',
);
const {
  IntegrationSecretValue,
} = require(
  '../dist/src/modules/integrations/secrets/integration-secret-vault.port.js',
);

const SECRET_REF = 'isv_' + 'A'.repeat(43);

function configuration(overrides = {}) {
  return {
    scope: 'TENANT',
    tenantId: 'gym-a',
    capability: 'WORKOUT_GENERATION',
    providerCode: 'provider-a',
    modelCode: 'model-a',
    endpoint: 'https://provider.example.com/v1',
    timeoutMs: 2000,
    budgetUnits: 100,
    enabled: true,
    fallbackBehavior: 'FAIL_CLOSED',
    secretReference: SECRET_REF,
    status: 'ACTIVE',
    version: 1,
    ...overrides,
  };
}

test('K1 resolves AI credential only through matching TENANT IntegrationConnection and canonical resolver', async () => {
  const calls = [];
  const service = new AiSecretReferenceService(
    {
      integrationConnection: {
        findMany: async ({ where }) => {
          assert.equal(where.scope, 'TENANT');
          assert.equal(where.gymId, 'gym-a');
          assert.equal(where.environment, 'HOMOLOG');
          assert.equal(where.providerCode, 'provider-a');
          assert.equal(where.secretReference, SECRET_REF);
          return [
            {
              id: 'ai-connection-a',
              capabilities: ['ai.workout_generation'],
            },
          ];
        },
      },
    },
    { current: () => 'HOMOLOG' },
    {
      resolveForExternalBoundary: async (connectionId, scope) => {
        calls.push({ connectionId, scope });
        return new IntegrationSecretValue('real-provider-secret');
      },
    },
  );

  const result = await service.resolveForExecution(
    configuration(),
    'gym-a',
  );

  assert.equal(result.available, true);
  assert.equal(result.connectionId, 'ai-connection-a');
  assert.equal(result.credential.toJSON(), '[REDACTED]');
  assert.deepEqual(calls, [
    {
      connectionId: 'ai-connection-a',
      scope: { scope: 'TENANT', gymId: 'gym-a' },
    },
  ]);
});

test('K1 fails closed when AI profile tenant diverges from authenticated tenant', async () => {
  const service = new AiSecretReferenceService(
    {
      integrationConnection: {
        findMany: async () => {
          throw new Error('must not query');
        },
      },
    },
    { current: () => 'HOMOLOG' },
    {
      resolveForExternalBoundary: async () => {
        throw new Error('must not resolve');
      },
    },
  );

  await assert.rejects(
    () =>
      service.resolveForExecution(
        configuration({ tenantId: 'gym-b' }),
        'gym-a',
      ),
    /diverge do tenant autenticado/,
  );
});

test('K1 capability isolation prevents workout-generation secret from serving content recommendation', async () => {
  let resolverCalls = 0;
  const service = new AiSecretReferenceService(
    {
      integrationConnection: {
        findMany: async () => [
          {
            id: 'ai-connection-a',
            capabilities: ['ai.workout_generation'],
          },
        ],
      },
    },
    { current: () => 'HOMOLOG' },
    {
      resolveForExternalBoundary: async () => {
        resolverCalls += 1;
        return new IntegrationSecretValue('secret');
      },
    },
  );

  const result = await service.resolveForExecution(
    configuration({
      capability: 'CONTENT_RECOMMENDATION',
    }),
    'gym-a',
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, 'SECRET_CONNECTION_NOT_FOUND');
  assert.equal(resolverCalls, 0);
});

test('K1 provider runtime receives redacted Vault credential only after config/budget/provider gates', async () => {
  const seen = [];
  const config = configuration();
  const runtime = new AiProviderExecutionService(
    {
      resolve: async () => ({
        available: true,
        source: 'TENANT',
        profileId: 'profile-a',
        configuration: config,
        flags: [],
      }),
    },
    {
      resolve: () => ({
        providerCode: 'provider-a',
        requiresCredential: true,
        execute: async (_request, _configuration, boundary) => {
          seen.push(boundary);
          return {
            status: 'SUCCEEDED',
            output: { ok: true },
            flags: [],
          };
        },
      }),
    },
    {
      resolveForExecution: async () => ({
        available: true,
        connectionId: 'ai-connection-a',
        credential: new IntegrationSecretValue(
          'real-provider-secret',
        ),
      }),
    },
    { reserve: async () => 'attempt-test', complete: async () => {} },
  );

  const result = await runtime.execute({
    capability: 'WORKOUT_GENERATION',
    prompt: {
      promptKey: 'workout.candidate_generation',
      promptVersion: 1,
    },
    context: {
      tenantId: 'gym-a',
      purpose: 'workout_candidate_generation',
      requestId: 'req-a',
    },
    input: { goal: 'strength' },
  });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].connectionId, 'ai-connection-a');
  assert.equal(seen[0].credential.toJSON(), '[REDACTED]');
  assert.equal(
    JSON.stringify(seen[0]).includes('real-provider-secret'),
    false,
  );
});

test('K1 required provider credential missing prevents adapter execution', async () => {
  let executions = 0;
  const runtime = new AiProviderExecutionService(
    {
      resolve: async () => ({
        available: true,
        source: 'TENANT',
        profileId: 'profile-a',
        configuration: configuration(),
        flags: [],
      }),
    },
    {
      resolve: () => ({
        providerCode: 'provider-a',
        requiresCredential: true,
        execute: async () => {
          executions += 1;
          return {
            status: 'SUCCEEDED',
            flags: [],
          };
        },
      }),
    },
    {
      resolveForExecution: async () => ({
        available: false,
        connectionId: null,
        credential: null,
        reason: 'SECRET_CONNECTION_NOT_FOUND',
      }),
    },
    { reserve: async () => 'attempt-test', complete: async () => {} },
  );

  const result = await runtime.execute({
    capability: 'WORKOUT_GENERATION',
    prompt: {
      promptKey: 'workout.candidate_generation',
      promptVersion: 1,
    },
    context: {
      tenantId: 'gym-a',
      purpose: 'workout_candidate_generation',
      requestId: 'req-a',
    },
    input: {},
  });

  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.failureCategory, 'BAD_CREDENTIALS');
  assert.equal(executions, 0);
});

test('K1 source uses canonical Integration Secret Vault and records real provider selection as external evidence', async () => {
  const [secrets, execution, moduleSource, docs] =
    await Promise.all([
      readFile(
        'src/modules/ai/secrets/ai-secret-reference.service.ts',
        'utf8',
      ),
      readFile(
        'src/modules/ai/runtime/ai-provider-execution.service.ts',
        'utf8',
      ),
      readFile('src/modules/ai/ai.module.ts', 'utf8'),
      readFile('docs/K1_AI_VAULT_RUNTIME.md', 'utf8'),
    ]);

  assert.match(secrets, /IntegrationSecretResolverService/);
  assert.match(
    secrets,
    /resolveForExternalBoundary/,
  );
  assert.match(secrets, /ai\.workout_generation/);
  assert.match(secrets, /ai\.content_recommendation/);
  assert.doesNotMatch(
    secrets,
    /process\.env|SECRET_BACKEND_NOT_CONFIGURED/,
  );
  assert.match(execution, /AI_SECRET_UNAVAILABLE/);
  assert.match(moduleSource, /IntegrationsModule/);
  assert.match(docs, /BLOCKED_EXTERNAL/);
  assert.match(docs, /real AI provider selected/);
});
