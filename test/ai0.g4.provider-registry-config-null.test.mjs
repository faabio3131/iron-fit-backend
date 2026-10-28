import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

test('AI0 G4 null provider is deterministic and never calls an external service', async () => {
  const { NullAiProviderAdapter } = require('../dist/src/modules/ai/providers/null-ai-provider.adapter.js');
  const provider = new NullAiProviderAdapter();
  const result = await provider.execute(
    {
      capability: 'ADVISORY_CHAT',
      prompt: { promptKey: 'student.chat', promptVersion: 1 },
      context: { tenantId: 'tenant-1', purpose: 'student_advisory_chat', requestId: 'req-1' },
      input: { message: 'hello' },
    },
    {
      scope: 'GLOBAL',
      capability: 'ADVISORY_CHAT',
      providerCode: 'missing_provider',
      modelCode: 'none',
      timeoutMs: 1000,
      enabled: true,
      fallbackBehavior: 'FAIL_CLOSED',
      status: 'ACTIVE',
      version: 1,
    },
  );
  assert.equal(provider.providerCode, 'null_provider');
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.failureCategory, 'UNAVAILABLE');
  assert.deepEqual(result.flags, ['AI_PROVIDER_UNAVAILABLE', 'NULL_PROVIDER']);
});

test('AI0 G4 registry is provider-neutral, duplicate-safe and falls back to Null Provider', async () => {
  const registry = await source('src/modules/ai/providers/ai-provider-registry.service.ts');
  assert.match(registry, /new Map<string, AiProviderAdapter>/);
  assert.match(registry, /Provider AI ja registrado/);
  assert.match(registry, /this\.providers\.get\(providerCode\) \?\? this\.nullProvider/);
  for (const vendor of ['openai', 'anthropic', 'gemini']) {
    assert.equal(registry.toLowerCase().includes(vendor), false);
  }
});

test('AI0 G4 config resolver enforces TENANT precedence and fail-closed override', async () => {
  const resolver = await source('src/modules/ai/configuration/ai-configuration-resolver.service.ts');
  const tenantIndex = resolver.indexOf('AiConfigurationScope.TENANT');
  const globalIndex = resolver.indexOf('AiConfigurationScope.GLOBAL');
  assert.ok(tenantIndex >= 0 && globalIndex > tenantIndex);
  assert.match(resolver, /if \(tenantProfile\)/);
  assert.match(resolver, /AI_CONFIGURATION_DISABLED/);
  assert.match(resolver, /AI_CONFIGURATION_NOT_FOUND/);
  assert.match(resolver, /defineAiExternalConfiguration/);
});

test('AI0 G4/K1 secret boundary uses canonical Integration Vault and never reads ad-hoc cleartext secrets', async () => {
  const secrets = await source('src/modules/ai/secrets/ai-secret-reference.service.ts');
  assert.match(secrets, /assertIntegrationSecretReference/);
  assert.match(secrets, /IntegrationSecretResolverService/);
  assert.match(secrets, /resolveForExternalBoundary/);
  assert.equal(secrets.includes('SECRET_BACKEND_NOT_CONFIGURED'), false);
  for (const forbidden of ['process.env', 'apiKey:', 'password:', 'token:']) {
    assert.equal(secrets.includes(forbidden), false);
  }
});

test('AI0 G4 runtime normalizes budget, timeout and provider failures', async () => {
  const runtime = await source('src/modules/ai/runtime/ai-provider-execution.service.ts');
  assert.match(runtime, /budgetUnits === 0/);
  assert.match(runtime, /AI_BUDGET_EXHAUSTED/);
  assert.match(runtime, /cancellation\.abort\(\)/);
  assert.match(runtime, /failureCategory: 'TIMEOUT'/);
  assert.match(runtime, /failureCategory: 'PROVIDER_INTERNAL_ERROR'/);
  assert.match(runtime, /provider\.providerCode === 'null_provider'/);
});

test('AI0 G4 module exposes G4 boundaries without adding mobile endpoints or G6 workflow', async () => {
  const moduleSource = await source('src/modules/ai/ai.module.ts');
  for (const service of [
    'AiConfigurationResolverService',
    'AiProviderRegistryService',
    'NullAiProviderAdapter',
    'AiSecretReferenceService',
    'AiProviderExecutionService',
  ]) {
    assert.match(moduleSource, new RegExp(service));
  }
  const docs = await source('docs/AI0_G4_PROVIDER_REGISTRY_CONFIG_NULL_PROVIDER.md');
  assert.match(docs, /sem endpoints `\/me\/ai\/\*` \(G5\)/);
  assert.match(docs, /sem workout candidate persistente \(G6\)/);
});
