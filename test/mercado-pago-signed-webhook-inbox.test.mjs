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
