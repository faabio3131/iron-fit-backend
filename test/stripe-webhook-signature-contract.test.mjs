import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { verifyStripeWebhookSignature } = require('../dist/src/modules/financial/stripe-payment-webhook-inbox.service.js');
test('signed payment callback rejects missing signature and raw request body', () => {
  assert.throws(() => verifyStripeWebhookSignature(Buffer.from('x'), '', 'invalid'), /WEBHOOK_SIGNATURE_INVALID/);
});
