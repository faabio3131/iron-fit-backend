import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BASE, request } from '../scripts/b6-e2e-lib.mjs';

const endpoint = '/control-plane/fmcc';

async function fmcc(path, { method = 'GET', secret, correlation = randomUUID(), key, body } = {}) {
  const headers = {
    'x-correlation-id': correlation,
    ...(secret ? { authorization: 'Bearer ' + secret } : {}),
    ...(key ? { 'Idempotency-Key': key } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };
  const res = await fetch(BASE + endpoint + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null };
}

test('P/Q Command-to-IRON live S2S: guard, snapshot, license status, idempotency, tenant boundary', async () => {
  const token = process.env.FMCC_IRON_CONTROL_PLANE_TOKEN;
  const ownerPassword = process.env.B6_OWNER_PASSWORD;
  assert.ok(token && token.length >= 32 && ownerPassword);
  assert.equal((await fmcc('/health')).status, 401);
  assert.equal((await fmcc('/health', { secret: 'invalid-ci-fmcc-control-token' })).status, 401);
  assert.equal((await fmcc('/health', { secret: token, correlation: '' })).status, 401);

  const health = await fmcc('/health', { secret: token });
  assert.equal(health.status, 200);
  assert.equal(health.body.billing_authority, 'FM_COMMAND');
  const plans = await fmcc('/plan-versions', { secret: token });
  assert.equal(plans.status, 200);
  assert.equal(plans.body.source_authority, 'IRON_PRODUCT_PLAN_VERSION');
  assert.ok(Array.isArray(plans.body.plans));
  const usage = await fmcc('/usage/ai?days=2', { secret: token });
  assert.equal(usage.status, 200);
  assert.equal(usage.body.product_code, 'IRON_FIT_CORE');

  const suffix = randomUUID().slice(0, 8);
  const provision = (await request('/commercial/trial/start', { method: 'POST', expected: 201,
    body: { requestId: randomUUID(), email: `s2s-${suffix}@example.com`,
      password: ownerPassword, name: 'S2S Isolated Owner',
      gymName: `S2S QA Gym ${suffix}`, timezone: 'America/Sao_Paulo' },
  })).payload;
  assert.ok(provision.gymId && provision.subscriptionId);

  const snapshot = await fmcc('/snapshot', { secret: token });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.schema_version, 'iron.fmcc.commercial.v1');
  assert.equal(snapshot.body.coverage.billing_transactions, 'FM_COMMAND_AUTHORITY');
  assert.ok(snapshot.body.subscriptions.some((row) => row.external_id === provision.subscriptionId));
  const serialized = JSON.stringify(snapshot.body);
  assert.ok(!serialized.includes(`s2s-${suffix}@example.com`), 'S2S must not export personal email');
  assert.ok(!serialized.includes(token), 'S2S must never export service secret');

  const baseCommand = {
    action: 'subscription.status.sync',
    gymId: provision.gymId,
    expectedSubscriptionId: provision.subscriptionId,
    commercialStatus: 'suspended',
    entitlementStatus: 'SUSPENDED',
    reason: 'isolated-ci-license-hold',
  };
  const key = 'iron-s2s-q-' + randomUUID();
  const first = await fmcc('/subscription/commands', { secret: token, method: 'POST', key, body: baseCommand });
  assert.equal(first.status, 201);
  assert.equal(first.body.idempotent, false);
  assert.equal(first.body.result.entitlementStatus, 'SUSPENDED');

  const replay = await fmcc('/subscription/commands', { secret: token, method: 'POST', key, body: baseCommand });
  assert.equal(replay.status, 201);
  assert.equal(replay.body.idempotent, true);
  assert.deepEqual(replay.body.result, first.body.result);

  const conflicting = await fmcc('/subscription/commands', { secret: token, method: 'POST', key, body: {
    ...baseCommand, commercialStatus: 'active', entitlementStatus: 'ACTIVE',
  } });
  assert.equal(conflicting.status, 409);

  const forgedTenant = await fmcc('/subscription/commands', { secret: token, method: 'POST',
    key: 'iron-s2s-foreign-' + randomUUID(), body: { ...baseCommand, gymId: randomUUID() } });
  assert.equal(forgedTenant.status, 404);

  const resumed = await fmcc('/subscription/commands', { secret: token, method: 'POST',
    key: 'iron-s2s-resume-' + randomUUID(), body: {
      ...baseCommand, commercialStatus: 'active', entitlementStatus: 'ACTIVE',
      reason: 'isolated-ci-reconciled-payment',
    } });
  assert.equal(resumed.status, 201);
  assert.equal(resumed.body.result.entitlementStatus, 'ACTIVE');

  console.log(JSON.stringify({ event: 'iron_fm_command_real_s2s_certified',
    routeCount: 5, tenantIsolation: true, serviceCredentialGuard: true,
    idempotentReplay: true, conflictingReplayDenied: true,
    statusTransitions: ['SUSPENDED', 'ACTIVE'], billingAuthority: 'FM_COMMAND' }));
}, { timeout: 120000 });
