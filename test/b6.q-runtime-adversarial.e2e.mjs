import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { login, request } from '../scripts/b6-e2e-lib.mjs';

const url = (process.env.B6_API_URL ?? 'http://127.0.0.1:3333/api/v1').replace(/\/$/, '');

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil((p / 100) * sorted.length) - 1] * 100) / 100;
}

test('Q internal: CORS, security headers, direct financial denial and HTTP latency', async () => {
  const ready = await fetch(`${url}/health/ready`);
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get('x-content-type-options'), 'nosniff');

  const roguePreflight = await fetch(`${url}/students`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://attacker.invalid',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization',
    },
  });
  assert.equal(roguePreflight.headers.get('access-control-allow-origin'), null);

  for (const headers of [{}, { Authorization: 'Bearer invalid-test-jwt' }]) {
    const denied = await fetch(`${url}/financial/accounts`, { headers });
    assert.equal(denied.status, 401);
  }

  const ownerPassword = process.env.B6_OWNER_PASSWORD;
  assert.ok(ownerPassword);
  const id = randomUUID().slice(0, 8);
  const email = `q-internal-${id}@example.com`;
  await request('/commercial/trial/start', {
    method: 'POST',
    expected: 201,
    body: {
      requestId: randomUUID(),
      name: 'Q Internal Owner',
      gymName: `Q Internal Gym ${id}`,
      email,
      password: ownerPassword,
      timezone: 'America/Sao_Paulo',
    },
  });
  const owner = await login(email, ownerPassword);

  const cold = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let i = 0; i < 10; i++) {
      const begin = performance.now();
      const response = await fetch(`${url}/health/ready`, { signal: AbortSignal.timeout(8000) });
      cold.push(performance.now() - begin);
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
  }));
  const authenticated = [];
  for (let i = 0; i < 15; i++) {
    const begin = performance.now();
    await request('/students', { expected: 200, token: owner.access_token });
    authenticated.push(performance.now() - begin);
  }

  const elapsed = performance.now() - started;
  const result = {
    event: 'iron_internal_runtime_http_baseline',
    environment: 'ISOLATED_CI_HOMOLOG',
    healthRequests: cold.length,
    authenticatedReads: authenticated.length,
    healthP50Ms: percentile(cold, 50),
    healthP95Ms: percentile(cold, 95),
    healthP99Ms: percentile(cold, 99),
    authenticatedP95Ms: percentile(authenticated, 95),
    elapsedMs: Math.round(elapsed),
  };
  assert.ok(result.healthP95Ms < 2500, `Health endpoint p95 exceeded CI baseline: ${JSON.stringify(result)}`);
  assert.ok(result.authenticatedP95Ms < 2500, `Authenticated endpoint p95 exceeded CI baseline: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
}, { timeout: 120000 });
