import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
const require = createRequire(import.meta.url);
const { verifyStripeWebhookSignature } = require('../dist/src/modules/financial/stripe-payment-webhook-inbox.service.js');
test('signed payment callback rejects missing signature and raw request body', () => {
  assert.throws(() => verifyStripeWebhookSignature(Buffer.from('x'), '', 'invalid'), /WEBHOOK_SIGNATURE_INVALID/);
});

test('signature is exact-body HMAC, timestamp bounded, and rejects tamper', () => {
  const raw = Buffer.from(JSON.stringify({ id: 'evt_test', type: 'test.event' }));
  const key = 'whsec_' + 'fixture';
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = (body, t) => 't=' + t + ',v1=' +
    createHmac('sha256', key).update(String(t)).update('.').update(body).digest('hex');
  assert.doesNotThrow(() => verifyStripeWebhookSignature(raw, signature(raw, timestamp), key));
  assert.throws(() => verifyStripeWebhookSignature(Buffer.from('tampered'), signature(raw, timestamp), key), /WEBHOOK_SIGNATURE_INVALID/);
  assert.throws(() => verifyStripeWebhookSignature(raw, signature(raw, timestamp - 1000), key), /WEBHOOK_SIGNATURE_EXPIRED/);
});
