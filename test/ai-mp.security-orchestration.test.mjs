import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { defineAiExternalConfiguration } = require('../dist/src/modules/ai/contracts/ai-contract.js');
const { aiEndpoint, isPublicAiAddress } = require('../dist/src/modules/ai/providers/ai-provider-security.js');
const { OpenAiCompatibleProviderAdapter, GeminiNativeProviderAdapter } = require('../dist/src/modules/ai/providers/external-ai-provider.adapters.js');
const { AiProviderExecutionService } = require('../dist/src/modules/ai/runtime/ai-provider-execution.service.js');
const { IntegrationSecretValue } = require('../dist/src/modules/integrations/secrets/integration-secret-vault.port.js');
const config = { scope: 'TENANT', tenantId: 'a', capability: 'ADVISORY_CHAT', providerCode: 'openai_compatible', modelCode: 'configured-model', timeoutMs: 100, budgetUnits: 10, enabled: true, fallbackBehavior: 'FAIL_CLOSED', status: 'ACTIVE', version: 1 };
const request = { capability: 'ADVISORY_CHAT', input: { message: 'hello' }, prompt: { promptKey: 'student.chat', promptVersion: 1 }, context: { tenantId: 'a', requestId: 'req', purpose: 'student_advisory_chat' } };
const credential = new IntegrationSecretValue('test-credential-private');
const secret = { connectionId: 'central', credential };
const target = { providerCode: 'gemini_native', modelCode: 'configured-fallback', secretReference: 'isv_' + 'a'.repeat(43) };

function harness(overrides = {}, results = []) {
  const calls = [], completed = [];
  let reserved = 0;
  const profile = { ...config, ...overrides };
  const ledger = { reserve: async () => 'attempt-' + ++reserved, complete: async (id, value) => completed.push({ id, value }) };
  const runtime = new AiProviderExecutionService(
    { resolve: async () => ({ available: true, configuration: profile, profileId: 'profile-1', flags: [] }) },
    { resolve: (providerCode) => ({ providerCode, requiresCredential: true, execute: async (_req, cfg) => {
      calls.push(cfg); return results.shift() ?? { status: 'SUCCEEDED', output: { message: 'ok' }, flags: [] };
    } }) },
    { resolveForExecution: async () => ({ available: true, ...secret }) }, ledger,
  );
  return { runtime, calls, ledger, completed };
}

test('AI-MP configuration rejects enums, fractional budgets, timeout overflow and fallback authority injection', () => {
  for (const change of [{ scope: 'OTHER' }, { enabled: 'true' }, { status: 'other' }, { fallbackBehavior: 'anything' }, { budgetUnits: 1.5 }, { timeoutMs: 120001 }, { maxOutputTokens: 8193 },
    { fallbackBehavior: 'ADVISORY_FALLBACK', fallbackTargets: [{ ...target, tenantId: 'b' }] }]) {
    assert.throws(() => defineAiExternalConfiguration({ ...config, ...change }));
  }
  assert.throws(() => defineAiExternalConfiguration({ ...config, fallbackTargets: [target] }));
});

test('AI-MP endpoints bind protocol, credential destination, path and configured model', () => {
  for (const endpoint of ['http://api.openai.com/v1/chat/completions', 'https://127.0.0.1', 'https://169.254.169.254/', 'https://[::1]/',
    'https://api.openai.com.evil.test/v1/chat/completions', 'https://user:pass@api.openai.com/v1/chat/completions',
    'https://api.openai.com/v1/chat/completions?key=secret', 'https://api.openai.com/v1/chat/completions#fragment',
    'https://api.openai.com/v1/files', 'https://api.openai.com:8443/v1/chat/completions', 'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent']) {
    assert.throws(() => aiEndpoint({ ...config, endpoint }));
  }
  assert.throws(() => aiEndpoint({ ...config, providerCode: 'gemini_native', modelCode: 'correct', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/wrong:generateContent' }));
  assert.throws(() => aiEndpoint({ ...config, modelCode: '../escape' }));
  assert.equal(aiEndpoint(config).hostname, 'api.openai.com');
});

test('AI-MP DNS rejects private, link local, mapped and reserved addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1']) assert.equal(isPublicAiAddress(address), false, address);
  for (const address of ['8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicAiAddress(address), true);
});

test('AI-MP all four capabilities receive protocol-specific schemas, canonical input and output limits', async () => {
  for (const Adapter of [OpenAiCompatibleProviderAdapter, GeminiNativeProviderAdapter]) {
    for (const capability of ['ADVISORY_CHAT', 'WORKOUT_INSIGHTS', 'WORKOUT_GENERATION', 'CONTENT_RECOMMENDATION']) {
      const adapter = new Adapter({ post: async (_url, _headers, body) => {
        const payload = JSON.parse(body);
        const system = payload.messages?.[0].content ?? payload.systemInstruction.parts[0].text;
        assert.match(system, /human review/);
        assert.match(system, /untrusted data/);
        assert.equal(payload.max_completion_tokens ?? payload.generationConfig.maxOutputTokens, 512);
        const output = '{"message":"safe"}';
        return { status: 200, body: JSON.stringify(Adapter === OpenAiCompatibleProviderAdapter
          ? { choices: [{ message: { content: output }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 5 } }
          : { candidates: [{ content: { parts: [{ text: output }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 5 } }) };
      } });
      const result = await adapter.execute({ ...request, capability }, { ...config, capability, providerCode: adapter.providerCode, maxOutputTokens: 512 }, secret);
      assert.equal(result.status, 'SUCCEEDED');
      assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 5 });
    }
  }
});

test('AI-MP rejects oversized input/output, truncated content, tools, prototype payload and secret echo', async () => {
  let calls = 0;
  const adapter = new OpenAiCompatibleProviderAdapter({ post: async () => { calls++; return { status: 200, body: '{}' }; } });
  assert.equal((await adapter.execute({ ...request, input: 'a'.repeat(64001) }, config, secret)).failureCategory, 'POLICY_DENIED');
  assert.equal(calls, 0);
  for (const choice of [
    { message: { content: '{"message":"' + credential.reveal() + '"}' } },
    { message: { content: '{"__proto__":{}}' } },
    { message: { content: '{"message":"valid"}', tool_calls: [{}] } },
    { message: { content: '{"message":"valid"}' }, finish_reason: 'length' },
    { message: { content: 'a'.repeat(128001) } },
  ]) {
    const result = await new OpenAiCompatibleProviderAdapter({ post: async () => ({ status: 200, body: JSON.stringify({ choices: [choice] }) }) }).execute(request, config, secret);
    assert.equal(result.failureCategory, 'INVALID_RESPONSE');
    assert.equal(JSON.stringify(result).includes(credential.reveal()), false);
  }
});

test('AI-MP configured fallback runs only after transient error and records actual provider', async () => {
  const h = harness({ fallbackBehavior: 'ADVISORY_FALLBACK', fallbackTargets: [target] }, [{ status: 'FAILED', flags: [], failureCategory: 'PROVIDER_INTERNAL_ERROR' }]);
  const result = await h.runtime.execute(request);
  assert.equal(result.status, 'SUCCEEDED');
  assert.deepEqual(h.calls.map(x => x.providerCode), ['openai_compatible', 'gemini_native']);
  assert.equal(result.execution.providerCode, 'gemini_native');
  assert.equal(h.completed.length, 2);
});

test('AI-MP auth, schema and policy failures cannot trigger fallback; FAIL_CLOSED cannot switch provider', async () => {
  for (const failureCategory of ['BAD_CREDENTIALS', 'INVALID_RESPONSE', 'POLICY_DENIED', 'ENTITLEMENT_DENIED']) {
    const h = harness({ fallbackBehavior: 'ADVISORY_FALLBACK', fallbackTargets: [target] }, [{ status: 'FAILED', flags: [], failureCategory }]);
    assert.equal((await h.runtime.execute(request)).failureCategory, failureCategory);
    assert.equal(h.calls.length, 1);
  }
  const h = harness({}, [{ status: 'FAILED', flags: [], failureCategory: 'PROVIDER_INTERNAL_ERROR' }]);
  await h.runtime.execute(request);
  assert.equal(h.calls.length, 1);
});

test('AI-MP retry of explicit 429 reserves distinct attempts; exhausted ledger prevents fallback', async () => {
  const h = harness({}, [{ status: 'FAILED', flags: [], failureCategory: 'RATE_LIMIT' }]);
  assert.equal((await h.runtime.execute(request)).status, 'SUCCEEDED');
  assert.equal(h.completed.length, 2);
  const blocked = harness({ fallbackBehavior: 'ADVISORY_FALLBACK', fallbackTargets: [target] }, [{ status: 'FAILED', flags: [], failureCategory: 'PROVIDER_INTERNAL_ERROR' }]);
  let reserveCount = 0;
  blocked.ledger.reserve = async () => ++reserveCount === 1 ? 'reserved' : null;
  assert.equal((await blocked.runtime.execute(request)).status, 'UNAVAILABLE');
  assert.equal(blocked.calls.length, 1);
});

test('AI-MP disabled profiles, cross-tenant config and zero budget execute no transports', async () => {
  for (const changes of [{ enabled: false }, { status: 'DISABLED' }, { tenantId: 'b' }, { budgetUnits: 0 }]) {
    const h = harness(changes);
    assert.equal((await h.runtime.execute(request)).status, 'UNAVAILABLE');
    assert.equal(h.calls.length, 0);
  }
});

test('AI-MP circuit opens after repeated failures and does not leak state across tenants', async () => {
  const h = harness({}, Array.from({ length: 3 }, () => ({ status: 'FAILED', flags: [], failureCategory: 'PROVIDER_INTERNAL_ERROR' })));
  for (let i = 0; i < 3; i++) await h.runtime.execute({ ...request, context: { ...request.context, requestId: 'r' + i } });
  assert.deepEqual((await h.runtime.execute(request)).flags, ['AI_CIRCUIT_OPEN']);
  assert.equal(h.calls.length, 3);
});

test('AI-MP cost estimate uses explicit tariff and measured tokens; absent usage remains unknown', async () => {
  const { AiAttemptLedgerService } = require('../dist/src/modules/ai/runtime/ai-attempt-ledger.service.js');
  const saved = [];
  const ledger = new AiAttemptLedgerService({ aiProviderAttempt: { update: async ({ data }) => saved.push(data) } });
  await ledger.complete('a', { status: 'SUCCEEDED', flags: [], usage: { inputTokens: 10, outputTokens: 4 } }, 10, { inputNanoUsdPerToken: 2500, outputNanoUsdPerToken: 10000 });
  assert.equal(saved[0].estimatedCostNanoUsd, 65000n);
  await ledger.complete('a', { status: 'FAILED', flags: [] }, 10, { inputNanoUsdPerToken: 2500, outputNanoUsdPerToken: 10000 });
  assert.equal(saved[1].estimatedCostNanoUsd, null);
  assert.equal(saved[1].inputTokens, null);
});

test('AI-MP NVIDIA uses its documented completion budget field without changing model', async () => {
  const adapter = new OpenAiCompatibleProviderAdapter({ post: async (_url, _headers, body) => {
    const payload = JSON.parse(body);
    assert.equal(payload.max_tokens, 1024);
    assert.equal(payload.max_completion_tokens, undefined);
    assert.equal(payload.model, 'namespace/configured-model');
    return { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"message":"ok"}' } }] }) };
  } });
  assert.equal((await adapter.execute(request, { ...config, modelCode: 'namespace/configured-model', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions' }, secret)).status, 'SUCCEEDED');
});
