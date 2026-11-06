import { fixtureCnpj } from './fixture-cnpj.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { BASE, login, request } from '../scripts/b6-e2e-lib.mjs';

function percentile(numbers, fraction) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

test('Q adversarial live API: invalid tokens, direct-object access, tenant spoofing and safe parse errors', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.IRON_RUNTIME_ENV, 'HOMOLOG');
  const pass = process.env.B6_OWNER_PASSWORD, staffPass = process.env.B6_STAFF_PASSWORD;
  assert.ok(pass && staffPass);
  const id = randomUUID().slice(0, 8);
  const createGym = async (name) => {
    const email = `q-adversarial-${name}-${id}@example.com`;
    const provision = (await request('/commercial/trial/start', { method: 'POST', expected: 201,
      body: { requestId: randomUUID(), name: 'Security QA Owner', cnpj: fixtureCnpj(), gymName: `Security QA ${name} ${id}`,
        email, password: pass, timezone: 'America/Sao_Paulo' } })).payload;
    return { email, provision, session: await login(email, pass) };
  };
  const a = await createGym('a'), b = await createGym('b');
  assert.notEqual(a.provision.gymId, b.provision.gymId);
  const forgedHeaders = {
    'X-Tenant-ID': b.provision.gymId,
    'X-Gym-ID': b.provision.gymId,
    'X-Unit-ID': b.provision.gymId,
  };
  const checks = [
    ['/students', 'GET'], ['/users', 'GET'], ['/financial/charges', 'GET'],
    ['/integrations/connections', 'GET'], ['/saas-billing/current', 'GET'],
    ['/control-plane/fmcc/snapshot', 'GET'],
  ];
  for (const [path, method] of checks) {
    for (const bearer of ['', 'Bearer invalid.jwt.payload']) {
      const result = await fetch(BASE + path, {
        method, headers: bearer ? { Authorization: bearer } : {},
      });
      assert.equal(result.status, 401, `Unexpected unprotected ${path} with ${bearer ? 'fake' : 'no'} token`);
    }
  }
  const studentEmail = `q-student-${id}@example.com`;
  const student = (await request('/students', { token: a.session.access_token, method: 'POST', expected: 201,
    body: { name: 'Q Security Student', email: studentEmail, goal: 'HIPERTROFIA', level: 'INICIANTE' },
  })).payload;
  await request(`/students/${student.id}`, { token: b.session.access_token, expected: 404 });
  // Attempt to override the signed gym via multiple untrusted transport boundaries.
  for (const headers of [forgedHeaders, { 'X-Forwarded-Host': 'attacker.invalid', ...forgedHeaders }]) {
    const list = (await request('/students', { token: a.session.access_token, expected: 200, headers })).payload;
    assert.ok(list.some((entry) => entry.id === student.id));
    assert.ok(list.every((entry) => entry.gymId === undefined || entry.gymId === a.provision.gymId));
  }
  // The students listing intentionally ignores untrusted gymId rather than
  // returning 4xx; the security invariant is zero visibility of gym B data.
  const tamperedTenantList = (await request(`/students?gymId=${b.provision.gymId}`, {
    token: a.session.access_token, expected: 200,
  })).payload;
  assert.ok(tamperedTenantList.some((entry) => entry.id === student.id));
  assert.ok(tamperedTenantList.every((entry) =>
    entry.gymId === undefined || entry.gymId === a.provision.gymId));
  const ownerFinancial = await request('/financial/accounts', {
    token: a.session.access_token, expected: 403,
  });
  assert.equal(ownerFinancial.status, 403, 'Step-up bypassed without session elevation');

  const staffEmail = `q-manager-${id}@example.com`;
  await request('/users', { method: 'POST', expected: 201, token: a.session.access_token,
    body: { name: 'Q Manager', email: staffEmail, password: staffPass, roleName: 'MANAGER' } });
  const manager = await login(staffEmail, staffPass);
  for (const path of ['/financial/charges', '/integrations/connections', '/saas-billing/current']) {
    await request(path, { token: manager.access_token, expected: 403 });
  }
  const malformedJson = await fetch(BASE + '/students', {
    method: 'POST', headers: {
      Authorization: 'Bearer ' + a.session.access_token,
      'Content-Type': 'application/json',
    }, body: '{"name": "unterminated',
  });
  assert.equal(malformedJson.status, 400);
  assert.equal(malformedJson.headers.get('content-type')?.includes('application/json'), true);
  const weirdQuery = await fetch(BASE + '/students?search=' + encodeURIComponent("' OR 1=1 --"), {
    headers: { Authorization: 'Bearer ' + a.session.access_token },
  });
  assert.ok(weirdQuery.status < 500, 'Malformed client input triggered 5xx');
  assert.equal((await fetch(BASE + '/health/ready')).status, 200);
  console.log(JSON.stringify({ event: 'iron_q_live_adversarial_authz',
    unauthenticatedChecks: checks.length * 2, crossTenantChecks: 4,
    spoofedHeaderChecks: 2, staffForbiddenChecks: 3, strictJsonParse: true,
    stepUpBypassRejected: true, productionCredentialsUsed: false,
  }));
}, { timeout: 120000 });

test('Q isolated bounded concurrent reads: per-scenario latency, throughput and error budget with real PostgreSQL', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.IRON_RUNTIME_ENV, 'HOMOLOG');
  const password = process.env.B6_OWNER_PASSWORD;
  assert.ok(password);
  const suffix = randomUUID().slice(0, 8);
  const email = `q-load-${suffix}@example.com`;
  await request('/commercial/trial/start', { method: 'POST', expected: 201,
    body: { requestId: randomUUID(), name: 'Q Load Owner', email, password,
      cnpj: fixtureCnpj(), gymName: `Q Load Gym ${suffix}`, timezone: 'America/Sao_Paulo' } });
  const session = await login(email, password);
  await request('/auth/step-up', {
    method: 'POST', token: session.access_token, expected: 200,
    body: { currentPassword: password },
  });
  const paths = [
    '/auth/me', '/students', '/workouts', '/schedules',
    '/financial/charges', '/saas-billing/current',
    '/product-entitlements/tenant/features',
  ];
  const samples = Object.fromEntries(paths.map(path => [path, []]));
  const limit = 16, total = paths.length * 40;
  const latencyMs = [], httpStatus = {};
  let counter = 0, failures = 0;
  const started = performance.now();
  const workers = Array.from({ length: limit }, async () => {
    while (counter < total) {
      const index = counter++;
      const path = paths[index % paths.length];
      const start = performance.now();
      const response = await fetch(BASE + path, {
        headers: { authorization: 'Bearer ' + session.access_token },
        signal: AbortSignal.timeout(10000),
      });
      await response.arrayBuffer();
      const latency = performance.now() - start;
      latencyMs.push(latency);
      samples[path].push(latency);
      httpStatus[response.status] = (httpStatus[response.status] ?? 0) + 1;
      if (response.status !== 200) failures++;
    }
  });
  await Promise.all(workers);
  const elapsedMs = Math.round(performance.now() - started);
  const latency = values => Object.fromEntries([50, 95, 99].map(p => [
    'p' + p, Math.round(percentile(values, p / 100) * 100) / 100,
  ]));
  const observed = latency(latencyMs);
  const result = {
    event: 'iron_q_bounded_postgres_load',
    environment: 'EPHEMERAL_CI_HOMOLOG', concurrentClients: limit,
    requests: total, httpStatus, elapsedMs,
    throughputRps: Math.round(1000 * total / elapsedMs * 100) / 100,
    latencyMs: observed, failures, errorRate: failures / total,
    scenarios: Object.fromEntries(paths.map(path => [
      path, { requests: samples[path].length, ...latency(samples[path]) },
    ])),
  };
  assert.equal(failures, 0, JSON.stringify(result));
  for (const [path, scenario] of Object.entries(result.scenarios)) {
    assert.equal(scenario.requests, 40, path);
    assert.ok(scenario.p95 < 5000, path + ' p95 exceeded CI limit: ' + JSON.stringify(scenario));
  }
  assert.equal((await fetch(BASE + '/health/ready')).status, 200);
  console.log(JSON.stringify(result));
}, { timeout: 120000 });
