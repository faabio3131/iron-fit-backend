import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
const require = createRequire(import.meta.url);
const { StripePaymentWebhookInboxService } = require('../dist/src/modules/financial/stripe-payment-webhook-inbox.service.js');
const { IntegrationSecretValue } = require('../dist/src/modules/integrations/secrets/integration-secret-vault.port.js');
const { Prisma } = require('@prisma/client');
const secret = 'whsec_' + 'integration_fixture';
const raw = Buffer.from(JSON.stringify({
  id: 'evt_checkout_test', type: 'checkout.session.completed', livemode: false,
  data: { object: { id: 'cs_test_a' } },
}));
function signed(body) {
  const t = Math.floor(Date.now() / 1000);
  return 't=' + t + ',v1=' + createHmac('sha256', secret)
    .update(String(t)).update('.').update(body).digest('hex');
}
function fixture({ duplicate = false } = {}) {
  const state = { rows: [], audits: [], vault: [] };
  const service = new StripePaymentWebhookInboxService({
    integrationConnection: { findFirst: async ({ where }) => {
      assert.equal(where.providerCode, 'stripe_webhook');
      assert.equal(where.scope, 'TENANT');
      return { id: 'connection-a', gymId: 'gym-a', authModel: 'WEBHOOK_SECRET',
        capabilities: ['billing.student.webhook'] };
    } },
    charge: { findFirst: async ({ where }) => {
      assert.equal(where.gymId, 'gym-a');
      assert.equal(where.gatewayChargeId, 'cs_test_a');
      return { id: 'charge-a' };
    } },
    tenantPaymentWebhookInbox: {
      create: async ({ data }) => {
        if (duplicate) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' });
        state.rows.push(data);
        return { id: 'row-a' };
      },
      findMany: async ({ where }) => { assert.equal(where.gymId, 'gym-a'); return []; },
    },
  }, { current: () => 'HOMOLOG' }, {
    resolveForExternalBoundary: async (id, scope) => {
      state.vault.push({ id, scope });
      return new IntegrationSecretValue(secret);
    },
  }, { record: async (item) => { state.audits.push(item); } });
  return { service, state };
}

test('HMAC verified Stripe notification persists only tenant-scoped metadata', async () => {
  const { service, state } = fixture();
  const result = await service.ingest('connection-a', signed(raw), raw);
  assert.deepEqual(result, { received: true, duplicate: false, status: 'RECEIVED' });
  assert.equal(state.rows[0].gymId, 'gym-a');
  assert.equal(state.rows[0].chargeId, 'charge-a');
  assert.equal(state.rows[0].providerEventId, 'evt_checkout_test');
  assert.deepEqual(state.vault[0].scope, { scope: 'TENANT', gymId: 'gym-a' });
  assert.doesNotMatch(JSON.stringify(state.rows), /whsec_|rawBody|authorization/);
  assert.equal(state.audits[0].action, 'FINANCIAL_STRIPE_SIGNED_WEBHOOK_RECEIVED');
  assert.deepEqual(await service.listForGym('gym-a'), []);
});

test('forged webhook does not write an inbox entry', async () => {
  const { service, state } = fixture();
  await assert.rejects(() => service.ingest('connection-a', signed(raw), Buffer.from('different')), /WEBHOOK_SIGNATURE_INVALID/);
  assert.equal(state.rows.length, 0);
  assert.equal(state.audits.length, 0);
});

test('provider retry is deduplicated without another ledger or audit effect', async () => {
  const { service, state } = fixture({ duplicate: true });
  const response = await service.ingest('connection-a', signed(raw), raw);
  assert.deepEqual(response, { received: true, duplicate: true, status: 'DUPLICATE' });
  assert.equal(state.rows.length, 0);
  assert.equal(state.audits.length, 0);
});
