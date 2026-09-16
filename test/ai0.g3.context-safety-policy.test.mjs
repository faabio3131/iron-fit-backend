import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

test('AI0 G3 sanitizer removes credentials, financial and fiscal material', () => {
  const { AiSanitizerService } = require('../dist/src/modules/ai/security/ai-sanitizer.service.js');
  const sanitizer = new AiSanitizerService();
  const sanitized = sanitizer.sanitize({
    goal: 'forca',
    accessToken: 'secret-token',
    password: '123',
    financial: { cardNumber: '4111111111111111', cvv: '123' },
    fiscalPayload: 'forbidden',
    note: 'Bearer abc.def.ghi token=supersecret',
  });
  const encoded = JSON.stringify(sanitized);
  assert.match(encoded, /forca/);
  for (const forbidden of ['secret-token', '4111111111111111', 'supersecret', 'fiscalPayload']) {
    assert.equal(encoded.includes(forbidden), false);
  }
  assert.match(encoded, /REDACTED/);
});

test('AI0 G3 context builder is explicit tenant-scoped allowlist', async () => {
  const context = await source('src/modules/ai/context/ai-context-builder.service.ts');
  assert.match(context, /gymId: request\.gymId/);
  assert.match(context, /userId: request\.userId/);
  assert.match(context, /status: 'ACTIVE'/);
  assert.match(context, /select: \{/);
  assert.match(context, /request\.includeHealthData === true && student\.consentHealth/);
  assert.equal(context.includes('notes: true'), false);
  assert.equal(context.includes('measurements: true'), false);
});

test('AI0 G3 policy maps AI capabilities to existing fail-closed entitlements', async () => {
  const policy = await source('src/modules/ai/policy/ai-policy-guard.service.ts');
  assert.match(policy, /WORKOUT_GENERATION: 'ai\.workout_generation'/);
  assert.match(policy, /WORKOUT_INSIGHTS: 'ai\.content_recommendation'/);
  assert.match(policy, /ADVISORY_CHAT: 'ai\.content_recommendation'/);
  assert.match(policy, /resolveFeatureForUser/);
  assert.match(policy, /resolution\.value !== true/);
});

test('AI0 G3 output validator delegates equipment and content to canonical resolvers', async () => {
  const validator = await source('src/modules/ai/validation/ai-output-validator.service.ts');
  assert.match(validator, /findCompatibleForExercise/);
  assert.match(validator, /resolveExerciseContent/);
  assert.match(validator, /EQUIPMENT_NOT_ELIGIBLE/);
  assert.match(validator, /CONTENT_NOT_ELIGIBLE/);
});

test('AI0 G3 rejects hallucinated URLs and authority mutations', async () => {
  const validator = await source('src/modules/ai/validation/ai-output-validator.service.ts');
  assert.match(validator, /MODEL_URL_REJECTED/);
  assert.match(validator, /AUTHORITY_MUTATION_REJECTED/);
  for (const key of ['approved', 'active', 'payment', 'fiscal', 'entitlement', 'rightsGrant', 'publish']) {
    assert.match(validator, new RegExp(`'${key}'`));
  }
});

test('AI0 G3 module consumes canonical Product, Equipment and Creator modules', async () => {
  const moduleSource = await source('src/modules/ai/ai.module.ts');
  assert.match(moduleSource, /ProductEntitlementsModule/);
  assert.match(moduleSource, /EquipmentsModule/);
  assert.match(moduleSource, /CreatorNetworkModule/);
  for (const forbidden of ['openai', 'anthropic', 'gemini']) {
    assert.equal(moduleSource.toLowerCase().includes(forbidden), false);
  }
});

test('AI0 G3 documentation fixes security and no-provider boundaries', async () => {
  const docs = await source('docs/AI0_G3_CONTEXT_SAFETY_POLICY.md');
  assert.match(docs, /Context Builder por allowlist/);
  assert.match(docs, /não pode inventar URL/);
  assert.match(docs, /sem provider registry ou NullProvider/);
  assert.match(docs, /sem endpoints mobile/);
});
