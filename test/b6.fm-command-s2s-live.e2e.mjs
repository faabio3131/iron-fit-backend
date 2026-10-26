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

  // A real FM Command commercial journey: trial -> Basic -> Pro -> Basic
  // is executed only through the canonical S2S endpoint, not IRON local
  // checkout or forged UI authority.
  const transition = async (subscriptionId, planCode, status, kind) => {
    const command = {
      action: 'subscription.plan.transition',
      gymId: provision.gymId,
      expectedSubscriptionId: subscriptionId,
      commercialStatus: status,
      planCode,
      planVersion: 1,
      transitionKind: kind,
      reason: 'CI linked commercial plan lifecycle',
    };
    const key = 'iron-s2s-plan-' + randomUUID();
    const response = await fmcc('/subscription/commands', {
      secret: token, method: 'POST', key, body: command,
    });
    assert.equal(response.status, 201, JSON.stringify({ planCode, response }));
    assert.equal(response.body.result.changed, true);
    assert.equal(response.body.result.subscription.status, 'ACTIVE');
    assert.equal(response.body.result.previousSubscription.id, subscriptionId);
    assert.equal(response.body.result.previousSubscription.status, 'CANCELED');
    const replay = await fmcc('/subscription/commands', {
      secret: token, method: 'POST', key, body: command,
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.body.idempotent, true);
    return response.body.result.subscription.id;
  };

  const basic1 = await transition(provision.subscriptionId, 'IRON_B6_BASIC', 'upgrade', 'UPGRADE');
  const pro = await transition(basic1, 'IRON_B6_PRO', 'upgrade', 'UPGRADE');
  const basic2 = await transition(pro, 'IRON_B6_BASIC', 'downgrade', 'DOWNGRADE');

  const cancelCommand = {
    ...baseCommand,
    expectedSubscriptionId: basic2,
    commercialStatus: 'cancelled',
    entitlementStatus: 'CANCELED',
    reason: 'CI canonical customer cancellation',
  };
  const cancelKey = 'iron-s2s-cancel-' + randomUUID();
  const cancelled = await fmcc('/subscription/commands', {
    secret: token, method: 'POST', key: cancelKey, body: cancelCommand,
  });
  assert.equal(cancelled.status, 201);
  assert.equal(cancelled.body.result.entitlementStatus, 'CANCELED');
  const cancelledReplay = await fmcc('/subscription/commands', {
    secret: token, method: 'POST', key: cancelKey, body: cancelCommand,
  });
  assert.equal(cancelledReplay.status, 201);
  assert.equal(cancelledReplay.body.idempotent, true);

  // Returning after cancellation requires a new commercial contracting
  // authority, never resurrects the terminated subscription by status.sync.
  const forbiddenRevival = await fmcc('/subscription/commands', {
    secret: token, method: 'POST', key: 'iron-s2s-revival-' + randomUUID(),
    body: {
      ...cancelCommand, commercialStatus: 'active',
      entitlementStatus: 'ACTIVE',
      reason: 'CI forbidden cancelled subscription resurrection',
    },
  });
  assert.equal(forbiddenRevival.status, 409);
  const history = await fmcc('/snapshot', { secret: token });
  const subscriptions = history.body.subscriptions.filter(row => row.tenant_id === provision.gymId);
  assert.ok(subscriptions.length >= 4);
  assert.equal(subscriptions.filter(row => row.status === 'ACTIVE').length, 0);
  assert.equal(subscriptions.filter(row => row.status === 'CANCELED').length, subscriptions.length);
  console.log(JSON.stringify({ event: 'iron_fm_command_complete_plan_lifecycle',
    trialToBasic: true, basicToPro: true, proToBasic: true,
    cancellation: true, replaySafe: true, cancelledCannotReactivate: true,
    tenantSubscriptionRows: subscriptions.length }));

  console.log(JSON.stringify({ event: 'iron_fm_command_real_s2s_certified',
    routeCount: 5, tenantIsolation: true, serviceCredentialGuard: true,
    idempotentReplay: true, conflictingReplayDenied: true,
    statusTransitions: ['SUSPENDED', 'ACTIVE'], billingAuthority: 'FM_COMMAND' }));
}, { timeout: 120000 });
