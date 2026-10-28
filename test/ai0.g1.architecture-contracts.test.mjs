import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

test('AI0 G1 exposes provider-neutral capabilities and failure taxonomy', () => {
  const contract = require('../dist/src/modules/ai/contracts/ai-contract.js');

  assert.deepEqual(contract.AI_CAPABILITIES, [
    'WORKOUT_INSIGHTS',
    'ADVISORY_CHAT',
    'WORKOUT_GENERATION',
    'CONTENT_RECOMMENDATION',
  ]);
  assert.deepEqual(contract.AI_FAILURE_CATEGORIES, [
    'TIMEOUT',
    'OFFLINE',
    'RATE_LIMIT',
    'BAD_CREDENTIALS',
    'UNAVAILABLE',
    'INVALID_RESPONSE',
    'POLICY_DENIED',
    'ENTITLEMENT_DENIED',
    'CONFIGURATION_UNAVAILABLE',
    'PROVIDER_INTERNAL_ERROR',
  ]);
});

test('AI0 G1 validates zero-code GLOBAL and TENANT configuration contracts', () => {
  const { defineAiExternalConfiguration } = require(
    '../dist/src/modules/ai/contracts/ai-contract.js',
  );

  const globalProfile = defineAiExternalConfiguration({
    scope: 'GLOBAL',
    capability: 'WORKOUT_INSIGHTS',
    providerCode: 'null-provider',
    modelCode: 'unavailable',
    timeoutMs: 4500,
    enabled: true,
    fallbackBehavior: 'ADVISORY_FALLBACK',
    status: 'UNAVAILABLE',
    version: 1,
  });
  assert.equal(globalProfile.scope, 'GLOBAL');

  const tenantProfile = defineAiExternalConfiguration({
    scope: 'TENANT',
    tenantId: 'gym-a',
    capability: 'ADVISORY_CHAT',
    providerCode: 'provider-a',
    modelCode: 'model-a',
    endpoint: 'https://provider.invalid/v1',
    region: 'br',
    timeoutMs: 3000,
    budgetUnits: 100,
    enabled: true,
    fallbackBehavior: 'ADVISORY_FALLBACK',
    secretReference: 'iron/tenant/gym-a/ai/provider-key',
    status: 'ACTIVE',
    version: 2,
  });
  assert.equal(tenantProfile.tenantId, 'gym-a');

  assert.throws(
    () =>
      defineAiExternalConfiguration({
        ...globalProfile,
        scope: 'GLOBAL',
        tenantId: 'forbidden',
      }),
    /GLOBAL nao aceita tenantId/,
  );
  assert.throws(
    () =>
      defineAiExternalConfiguration({
        ...tenantProfile,
        scope: 'TENANT',
        tenantId: undefined,
      }),
    /TENANT exige tenantId/,
  );
});

test('AI0 G1 rejects inline secrets and insecure endpoints', () => {
  const { assertSecretReference, defineAiExternalConfiguration } = require(
    '../dist/src/modules/ai/contracts/ai-contract.js',
  );

  assert.equal(
    assertSecretReference('iron/tenant/gym-a/ai/provider-key'),
    'iron/tenant/gym-a/ai/provider-key',
  );
  assert.throws(() => assertSecretReference('api_key=secret-value'), /secretReference/);
  assert.throws(
    () =>
      defineAiExternalConfiguration({
        scope: 'GLOBAL',
        capability: 'WORKOUT_INSIGHTS',
        providerCode: 'provider-a',
        modelCode: 'model-a',
        endpoint: 'http://insecure.invalid',
        timeoutMs: 1000,
        enabled: true,
        fallbackBehavior: 'ADVISORY_FALLBACK',
        status: 'ACTIVE',
        version: 1,
      }),
    /HTTPS/,
  );
});

test('AI0 G1 stays vendor-neutral and persistence-free', async () => {
  const contract = await source('src/modules/ai/contracts/ai-contract.ts');
  const moduleSource = await source('src/modules/ai/ai.module.ts');
  const docs = await source('docs/AI0_G1_ARCHITECTURE_CONTRACTS.md');

  for (const forbidden of ['openai', 'anthropic', '@google/generative-ai', '@prisma/client']) {
    assert.equal(contract.toLowerCase().includes(forbidden), false);
    // The adapter wiring is vendor-aware after AI-MP; the canonical contract remains neutral.

  }
  assert.match(moduleSource, /external-ai-provider\.adapters/);
  assert.match(moduleSource, /this\.registry\.register/);
  assert.match(docs, /Novo CLIENTE = configuração/);
  assert.match(docs, /nenhuma migration/);
  assert.match(docs, /nenhum endpoint `\/me\/ai\/\*`/);
});

test('AI0 G1 preserves human authority and canonical entitlement capabilities', async () => {
  const docs = await source('docs/AI0_G1_ARCHITECTURE_CONTRACTS.md');
  const product = await source(
    'src/modules/product-entitlements/contracts/product-entitlement-contract.ts',
  );

  assert.match(product, /ai\.workout_generation/);
  assert.match(product, /ai\.content_recommendation/);
  assert.match(docs, /não pode autonomamente[\s\S]*ativar treino/);
  assert.match(docs, /AI0 consome, não duplica/);
});
