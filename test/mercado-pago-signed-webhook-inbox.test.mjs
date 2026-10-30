import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { verifyMercadoPagoWebhookSignature, MercadoPagoPaymentWebhookInboxService } =
  require('../dist/src/modules/financial/mercado-pago-payment-webhook-inbox.service.js');
const { IntegrationSecretValue } = require('../dist/src/modules/integrations/secrets/integration-secret-vault.port.js');

const secret = 'mp_' + 'webhook_test_key';
const requestId = 'request-abc';
const dataId = '12345';
const ts = String(Date.now());
const manifest = 'id:' + dataId + ';request-id:' + requestId + ';ts:' + ts + ';';
const signature = 'ts=' + ts + ',v1=' + createHmac('sha256', secret).update(manifest).digest('hex');
const raw = Buffer.from(JSON.stringify({
  id: 67890, type: 'payment', action: 'payment.updated', live_mode: false,
  data: { id: dataId },
}));

test('Mercado Pago validates signature, timestamp and data ID exactly', () => {
  assert.doesNotThrow(() => verifyMercadoPagoWebhookSignature(signature, requestId, dataId, secret));
  assert.throws(() => verifyMercadoPagoWebhookSignature(signature, requestId, '99999', secret), /MP_WEBHOOK_SIGNATURE_INVALID/);
  assert.throws(() => verifyMercadoPagoWebhookSignature(signature, 'other', dataId, secret), /MP_WEBHOOK_SIGNATURE_INVALID/);
  assert.throws(() => verifyMercadoPagoWebhookSignature(signature, requestId, dataId, secret, Date.now() + 800_000), /MP_WEBHOOK_SIGNATURE_EXPIRED/);
});

test('signed Mercado Pago notification is safely stored without affecting payment ledger', async () => {
  const writes = [];
  const audits = [];
  const service = new MercadoPagoPaymentWebhookInboxService({
    integrationConnection: { findFirst: async ({ where }) => {
      assert.equal(where.scope, 'TENANT');
      assert.equal(where.providerCode, 'mercado_pago_webhook');
      return { id: 'connection-mp', gymId: 'gym-a', authModel: 'WEBHOOK_SECRET',
        capabilities: ['billing.student.webhook'] };
    } },
    tenantPaymentWebhookInbox: {
      create: async ({ data }) => { writes.push(data); return { id: 'inbox-a' }; },
    },
  }, { current: () => 'HOMOLOG' }, {
    resolveForExternalBoundary: async (id, scope) => {
      assert.deepEqual(scope, { scope: 'TENANT', gymId: 'gym-a' });
      return new IntegrationSecretValue(secret);
    },
  }, { record: async (entry) => audits.push(entry) });
  const result = await service.ingest('connection-mp', signature, requestId, dataId, raw);
  assert.equal(result.received, true);
  assert.equal(writes[0].gymId, 'gym-a');
  assert.equal(writes[0].status, 'UNMATCHED');
  assert.equal(writes[0].providerEventId, '67890');
  assert.equal(writes[0].chargeId, null);
  assert.equal(audits[0].action, 'FINANCIAL_MP_SIGNED_WEBHOOK_RECEIVED');
  assert.doesNotMatch(JSON.stringify(writes), /webhook_test_key|rawBody/);
});

test('signed Mercado Pago event binds to a verified same-tenant merchant payment', async () => {
  const old = globalThis.fetch;
  const chargeId = '11111111-1111-4111-8111-111111111111';
  const rows = [];
  let merchantReads = 0;
  globalThis.fetch = async (url, options) => {
    merchantReads += 1;
    assert.equal(String(url), 'https://api.mercadopago.com/v1/payments/12345');
    assert.equal(options.headers.authorization, 'Bearer mp-merchant-test-secret');
    return new Response(JSON.stringify({
      id: 12345, external_reference: chargeId, transaction_amount: 49.9,
      currency_id: 'BRL', status: 'approved',
    }), { status: 200 });
  };
  try {
    const service = new MercadoPagoPaymentWebhookInboxService({
      integrationConnection: { findFirst: async ({ where }) => {
        if (where.providerCode === 'mercado_pago_webhook') return {
          id: 'signing-connection', gymId: 'gym-a',
          authModel: 'WEBHOOK_SECRET', capabilities: ['billing.student.webhook'],
          publicConfiguration: { paymentConnectionId: 'merchant-connection' },
        };
        assert.equal(where.id, 'merchant-connection');
        assert.equal(where.providerCode, 'mercado_pago');
        assert.equal(where.gymId, 'gym-a');
        return { id: 'merchant-connection' };
      } },
      charge: { findFirst: async ({ where }) => {
        assert.equal(where.id, chargeId);
        assert.equal(where.gymId, 'gym-a');
        assert.equal(where.gatewayConnectionId, 'merchant-connection');
        assert.equal(where.amount, 4990);
        return { id: chargeId };
      } },
      tenantPaymentWebhookInbox: {
        create: async ({ data }) => { rows.push(data); return { id: 'inbox-a' }; },
      },
    }, { current: () => 'HOMOLOG' }, {
      resolveForExternalBoundary: async (id, scope) => {
        assert.equal(scope.gymId, 'gym-a');
        return new IntegrationSecretValue(id === 'signing-connection' ? secret : 'mp-merchant-test-secret');
      },
    }, { record: async () => {} });
    const result = await service.ingest('signing-connection', signature, requestId, dataId, raw);
    assert.equal(result.status, 'RECEIVED');
    assert.equal(rows[0].chargeId, chargeId);
    assert.equal(merchantReads, 1);
  } finally { globalThis.fetch = old; }
});
