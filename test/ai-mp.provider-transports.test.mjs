import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { IntegrationSecretValue } = require('../dist/src/modules/integrations/secrets/integration-secret-vault.port.js');
const { OpenAiCompatibleProviderAdapter, GeminiNativeProviderAdapter } = require('../dist/src/modules/ai/providers/external-ai-provider.adapters.js');
const req = { capability: 'ADVISORY_CHAT', prompt: { promptKey: 'student.chat', promptVersion: 1 }, context: { tenantId: 'tenantA', requestId: 'r1', purpose: 'advisory' }, input: { message: 'hi' } };
const base = { scope: 'GLOBAL', capability: 'ADVISORY_CHAT', modelCode: 'configured-model', timeoutMs: 1500, enabled: true, fallbackBehavior: 'FAIL_CLOSED', status: 'ACTIVE', version: 1 };
const secret = { connectionId: 'vault-ref', credential: new IntegrationSecretValue('test-secret') };

test('OpenAI-compatible adapter uses configured model, credential and structured result', async () => {
  const before = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (url, opts) => {
    count++;
    assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
    assert.equal(opts.headers.Authorization, 'Bearer test-secret');
    assert.equal(JSON.parse(opts.body).model, 'configured-model');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"ok"}' } }] }), { status: 200 });
  };
  try {
    const result = await new OpenAiCompatibleProviderAdapter().execute(req, { ...base, providerCode: 'openai_compatible' }, secret);
    assert.equal(result.status, 'SUCCEEDED');
    assert.deepEqual(result.output, { message: 'ok' });
    assert.equal(count, 1);
  } finally { globalThis.fetch = before; }
});

test('Gemini native adapter uses configured model and returns canonical JSON output', async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    assert.match(String(url), /generativelanguage.googleapis.com/);
    assert.equal(opts.headers['x-goog-api-key'], 'test-secret');
    assert.match(String(url), /configured-model/);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"reply":"ok"}' }] } }] }), { status: 200 });
  };
  try {
    const result = await new GeminiNativeProviderAdapter().execute(req, { ...base, providerCode: 'gemini_native' }, secret);
    assert.equal(result.status, 'SUCCEEDED');
    assert.deepEqual(result.output, { reply: 'ok' });
  } finally { globalThis.fetch = before; }
});

test('adapters fail closed on absent credentials and untrusted endpoints', async () => {
  const adapter = new OpenAiCompatibleProviderAdapter();
  assert.equal((await adapter.execute(req, { ...base, providerCode: adapter.providerCode })).status, 'UNAVAILABLE');
  const before = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('unexpected network'); };
  try {
    await assert.rejects(() => adapter.execute(req, { ...base, providerCode: adapter.providerCode, endpoint: 'https://127.0.0.1/latest' }, secret));
    assert.equal(called, false);
  } finally { globalThis.fetch = before; }
});

test('upstream auth and throttling errors are normalized', async () => {
  const before = globalThis.fetch;
  try {
    for (const [status, category] of [[401, 'BAD_CREDENTIALS'], [429, 'RATE_LIMIT'], [502, 'PROVIDER_INTERNAL_ERROR']]) {
      globalThis.fetch = async () => new Response('{}', { status });
      const result = await new OpenAiCompatibleProviderAdapter().execute(req, { ...base, providerCode: 'openai_compatible' }, secret);
      assert.equal(result.failureCategory, category);
      assert.equal(result.status, 'FAILED');
    }
  } finally { globalThis.fetch = before; }
});

test('FM-only AI provider catalog uses global credential authority', async () => {
  const { readFileSync } = await import('node:fs');
  const bootstrap = readFileSync('src/modules/integrations/integration-provider-bootstrap.service.ts', 'utf8');
  const management = readFileSync('src/modules/integrations/integration-credential-admin.service.ts', 'utf8');
  for (const provider of ['openai_compatible', 'gemini_native']) assert.ok(bootstrap.includes(provider));
  for (const capability of ['ai.workout_insights', 'ai.advisory_chat', 'ai.workout_generation', 'ai.content_recommendation']) assert.ok(bootstrap.includes(capability));
  assert.match(bootstrap, /authModels: \['API_KEY'\]/);
  assert.match(management, /if \(!featureKey\)/);
  assert.match(management, /Provider nao possui entitlement comercial configurado para tenant/);
});

test('FM provider credential probes use fixed trusted endpoints and never expose keys', async () => {
  const { AiCredentialProbeBootstrapService } = require('../dist/src/modules/integrations/ai-credential-probe-bootstrap.service.js');
  const registered = new Map();
  new AiCredentialProbeBootstrapService({ register: (code, probe) => registered.set(code, probe) }).onModuleInit();
  const before = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    seen.push([url, opts]);
    return new Response('{}', { status: 200 });
  };
  try {
    await registered.get('openai_compatible').verify({ authModel: 'API_KEY', publicConfiguration: { apiFamily: 'nvidia' }, secret: secret.credential });
    await registered.get('gemini_native').verify({ authModel: 'API_KEY', publicConfiguration: null, secret: secret.credential });
    assert.match(seen[0][0], /^https:\/\/integrate\.api\.nvidia\.com\/v1\/models$/);
    assert.match(seen[1][0], /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/);
    assert.equal(seen[0][1].headers.Authorization, 'Bearer test-secret');
    assert.equal(seen[1][1].headers['x-goog-api-key'], 'test-secret');
    await assert.rejects(() => registered.get('openai_compatible').verify({ authModel: 'API_KEY', publicConfiguration: { apiFamily: 'untrusted' }, secret: secret.credential }));
    assert.equal(seen.length, 2);
  } finally { globalThis.fetch = before; }
});

test('FM-only profile administration enforces step-up, verified global Vault and tenant isolation', async () => {
  const { AiConfigurationAdminService } = require('../dist/src/modules/ai/configuration/ai-configuration-admin.service.js');
  const ref = 'isv_' + 'a'.repeat(43);
  const connection = { capabilities: ['ai.advisory_chat'] };
  let saved = 0, authorized = 0, checked = 0;
  const service = new AiConfigurationAdminService(
    { integrationConnection: { findFirst: async (query) => {
      checked++;
      assert.equal(query.where.scope, 'GLOBAL');
      assert.equal(query.where.gymId, null);
      assert.equal(query.where.secretReference, ref);
      return connection;
    } } },
    { assertStepUp: async () => { authorized++; } },
    { current: () => 'HOMOLOG' },
    { has: (code) => code === 'openai_compatible' },
    { createConfigurationProfile: async (config) => { saved++; return { ...config, id: 'profile' }; } },
  );
  const cfg = {
    scope: 'TENANT', tenantId: 'gym-a', capability: 'ADVISORY_CHAT',
    providerCode: 'openai_compatible', modelCode: 'test-model',
    timeoutMs: 1000, budgetUnits: 50, enabled: true,
    fallbackBehavior: 'FAIL_CLOSED', status: 'ACTIVE', version: 1,
    secretReference: ref, currentPassword: 'only-used-for-stepup',
  };
  const ok = await service.create('fm-admin', cfg);
  assert.equal(ok.id, 'profile');
  assert.equal(ok.tenantId, 'gym-a');
  assert.equal(saved, 1);
  assert.equal(checked, 1);
  assert.equal(authorized, 1);
  await assert.rejects(() => service.create('fm-admin', { ...cfg, providerCode: 'unauthorized' }));
  await assert.rejects(() => service.create('fm-admin', { ...cfg, secretReference: undefined }));
  assert.equal(saved, 1);
});
test('FM-managed tenant-selected profile resolves only central Vault reference', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/modules/ai/secrets/ai-secret-reference.service.ts', 'utf8');
  assert.match(source, /fmManaged/);
  assert.match(source, /!fmManaged && configuration\.scope === 'TENANT'/);
  const controller = readFileSync('src/modules/ai/configuration/ai-configuration-admin.controller.ts', 'utf8');
  assert.match(controller, /@Roles\('SUPER_ADMIN'\)/);
  assert.match(controller, /JwtAuthGuard/);
});

test('governed timeout aborts the in-flight provider request and classifies TIMEOUT', async () => {
  const { AiProviderExecutionService } = require('../dist/src/modules/ai/runtime/ai-provider-execution.service.js');
  let aborted = false;
  const execution = new AiProviderExecutionService(
    { resolve: async () => ({ available: true, configuration: {
      ...base, providerCode: 'openai_compatible', budgetUnits: 1,
      timeoutMs: 20, secretReference: 'isv_' + 'b'.repeat(43),
    } }) },
    { resolve: () => ({ providerCode: 'openai_compatible', requiresCredential: true,
      execute: (_req, _config, context) => new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('request aborted'));
        }, { once: true });
      }),
    }) },
    { resolveForExecution: async () => ({ available: true, connectionId: 'FM', credential: secret.credential }) },
  );
  const result = await execution.execute(req);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failureCategory, 'TIMEOUT');
  assert.equal(aborted, true);
});
