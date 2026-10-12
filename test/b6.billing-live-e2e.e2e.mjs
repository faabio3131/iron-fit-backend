import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { login, request } from '../scripts/b6-e2e-lib.mjs';

test('B6 SaaS billing is read-only in IRON and mutation authority belongs to FM Command', async () => {
  const suffix = randomUUID().slice(0, 8);
  const ownerPassword = process.env.B6_OWNER_PASSWORD;
  assert.ok(ownerPassword);

  const email = `b6-billing-authority-${suffix}@example.com`;
  await request('/commercial/trial/start', {
    method: 'POST',
    expected: 201,
    body: {
      requestId: randomUUID(),
      email,
      password: ownerPassword,
      name: 'B6 Billing Authority Owner',
      gymName: `B6 Billing Authority ${suffix}`,
      timezone: 'America/Sao_Paulo',
    },
  });

  const owner = await login(email, ownerPassword);

  await request('/auth/step-up', {
    method: 'POST',
    token: owner.access_token,
    expected: 200,
    body: { currentPassword: ownerPassword },
  });

  const authority = (await request('/saas-billing/authority', {
    token: owner.access_token,
    expected: 200,
  })).payload;

  assert.equal(authority.billingAuthority, 'FM_COMMAND');
  assert.equal(authority.productCode, 'IRON_FIT_CORE');
  assert.equal(authority.localMutationsEnabled, false);
  assert.equal(authority.providerWebhooksAccepted, false);
  assert.equal(authority.mode, 'COMMAND_CENTRALIZED');

  const current = (await request('/saas-billing/current', {
    token: owner.access_token,
    expected: 200,
  })).payload;
  assert.equal(current.authority.billingAuthority, 'FM_COMMAND');
  assert.equal(current.projection, 'LEGACY_READ_ONLY');

  for (const path of [
    '/saas-billing/checkout',
    '/saas-billing/change-plan',
    '/saas-billing/cancel',
    '/saas-billing/refunds',
    '/saas-billing/admin/recurrence/run',
    '/saas-billing/admin/dunning/run',
    '/saas-billing/admin/reconcile',
  ]) {
    await request(path, {
      method: 'POST',
      token: owner.access_token,
      expected: 404,
      body: {},
    });
  }

  await request('/saas-billing/webhooks/INTERNAL_SANDBOX', {
    method: 'POST',
    expected: 404,
    body: {
      eventId: 'legacy-webhook-must-not-be-routable',
      eventType: 'invoice.paid',
      occurredAt: new Date().toISOString(),
      data: {},
    },
  });
}, { timeout: 60000 });
