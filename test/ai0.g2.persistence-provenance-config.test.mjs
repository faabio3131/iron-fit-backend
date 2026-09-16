import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(path, 'utf8');
}

test('AI0 G2 adds only governed configuration and provenance persistence', async () => {
  const schema = await source('prisma/ai.prisma');
  assert.match(schema, /model AiConfigurationProfile/);
  assert.match(schema, /model AiExecutionTrace/);
  assert.match(schema, /secretReference\s+String\?/);
  for (const forbidden of ['apiKey ', 'secretValue', 'rawPrompt', 'rawRequest', 'rawResponse']) {
    assert.equal(schema.includes(forbidden), false);
  }
});

test('AI0 G2 migration physically enforces tenant scope and version uniqueness', async () => {
  const migration = await source(
    'prisma/migrations/20260916162500_ai_provenance_configuration_profiles/migration.sql',
  );
  assert.match(migration, /AiConfigurationProfile_scope_shape/);
  assert.match(migration, /WHERE "scope" = 'GLOBAL'/);
  assert.match(migration, /WHERE "scope" = 'TENANT'/);
  assert.match(migration, /AiConfigurationProfile_gymId_fkey/);
  assert.match(migration, /AiExecutionTrace_gymId_fkey/);
  assert.match(migration, /AiExecutionTrace_studentId_fkey/);
});

test('AI0 G2 migration rejects unsafe config and malformed provenance', async () => {
  const migration = await source(
    'prisma/migrations/20260916162500_ai_provenance_configuration_profiles/migration.sql',
  );
  assert.match(migration, /endpoint_https/);
  assert.match(migration, /secret_reference_only/);
  assert.match(migration, /input_hash_sha256/);
  assert.match(migration, /output_hash_sha256/);
  assert.match(migration, /confidence_range/);
  assert.match(migration, /latency_nonnegative/);
});

test('AI0 G2 service versions profiles server-side and audits without secret reference value', async () => {
  const service = await source('src/modules/ai/ai-persistence.service.ts');
  assert.match(service, /expectedVersion = \(latest\?\.version \?\? 0\) \+ 1/);
  assert.match(service, /AI_CONFIGURATION_PROFILE_CREATED/);
  assert.match(service, /secretReferenceConfigured: Boolean\(profile\.secretReference\)/);
  assert.equal(service.includes('next: {\n            secretReference:'), false);
});

test('AI0 G2 execution trace is idempotent by requestId and binds profile provenance', async () => {
  const service = await source('src/modules/ai/ai-persistence.service.ts');
  assert.match(service, /findUnique\(\{\s*where: \{ requestId: input\.requestId \}/);
  assert.match(service, /requestId ja vinculado a outra execucao de IA/);
  assert.match(service, /Perfil de configuracao nao corresponde a proveniencia/);
  assert.match(service, /AI_EXECUTION_TRACED/);
});

test('AI0 G2 module exports persistence without provider runtime', async () => {
  const moduleSource = await source('src/modules/ai/ai.module.ts');
  assert.match(moduleSource, /AiPersistenceService/);
  for (const forbidden of ['openai', 'anthropic', 'gemini', 'AiProviderRegistry', 'Controller']) {
    assert.equal(moduleSource.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});
