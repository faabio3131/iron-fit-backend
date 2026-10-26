import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { BASE, login, request } from '../scripts/b6-e2e-lib.mjs';

function p95(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
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
      body: { requestId: randomUUID(), name: 'Security QA Owner', gymName: `Security QA ${name} ${id}`,
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
  await request(`/students?gymId=${b.provision.gymId}`, {
    token: a.session.access_token, expected: [400, 403, 404],
  });
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

test('Q isolated bounded concurrent reads: sustained rate, p95 and 5xx budget with real PostgreSQL', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.IRON_RUNTIME_ENV, 'HOMOLOG');
  const password = process.env.B6_OWNER_PASSWORD;
  assert.ok(password);
  const suffix = randomUUID().slice(0, 8);
  const email = `q-load-${suffix}@example.com`;
  await request('/commercial/trial/start', { method: 'POST', expected: 201,
    body: { requestId: randomUUID(), name: 'Q Load Owner', email, password,
      gymName: `Q Load Gym ${suffix}`, timezone: 'America/Sao_Paulo' } });
  const session = await login(email, password);
  const limit = 16, total = 240;
  const latencyMs = [], httpStatus = {};
  let counter = 0, failures = 0;
  const started = performance.now();
  const workers = Array.from({ length: limit }, async () => {
    while (counter < total) {
      const index = counter++;
      const path = index % 3 === 0 ? '/students' : index % 3 === 1
        ? '/product-entitlements/tenant/features' : '/auth/me';
      const start = performance.now();
      const response = await fetch(BASE + path, {
        headers: { authorization: 'Bearer ' + session.access_token },
        signal: AbortSignal.timeout(10000),
      });
      await response.arrayBuffer();
      latencyMs.push(performance.now() - start);
      httpStatus[response.status] = (httpStatus[response.status] ?? 0) + 1;
      if (response.status !== 200) failures++;
    }
  });
  await Promise.all(workers);
  const elapsedMs = Math.round(performance.now() - started);
  const observedP95 = Math.round(p95(latencyMs) * 100) / 100;
  const result = {
    event: 'iron_q_bounded_postgres_load',
    environment: 'EPHEMERAL_CI_HOMOLOG', concurrentClients: limit,
    requests: total, httpStatus, elapsedMs,
    throughputRps: Math.round(1000 * total / elapsedMs * 100) / 100,
    p95Ms: observedP95, failures,
  };
  assert.equal(failures, 0, JSON.stringify(result));
  assert.ok(observedP95 < 5000, JSON.stringify(result));
  assert.equal((await fetch(BASE + '/health/ready')).status, 200);
  console.log(JSON.stringify(result));
}, { timeout: 120000 });
