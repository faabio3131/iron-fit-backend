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
