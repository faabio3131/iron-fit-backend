import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { StripeCheckoutAdapter } = require('../dist/src/modules/financial/stripe-checkout.adapter.js');
const { IntegrationSecretValue } = require('../dist/src/modules/integrations/secrets/integration-secret-vault.port.js');

const fixture = {
  requestId: '11111111-1111-4111-8111-111111111111',
  chargeId: '22222222-2222-4222-8222-222222222222',
  studentId: '33333333-3333-4333-8333-333333333333',
  amount: 12345, currency: 'BRL', dueDate: null,
  publicConfiguration: { successUrl: 'https://academia.example/success', cancelUrl: 'https://academia.example/cancel' },
  credential: new IntegrationSecretValue('vault-only-stripe-test-secret'),
};

test('Stripe Checkout uses provider idempotency and exact integer centavos without card data', async () => {
  const old = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/abc',
      expires_at: 1793000000,
    }), { status: 200 });
  };
  try {
    const registered = [];
    const adapter = new StripeCheckoutAdapter({ register: (value) => registered.push(value) });
    adapter.onModuleInit();
    assert.equal(registered[0], adapter);
    const response = await adapter.createCheckout(fixture);
    assert.equal(response.providerChargeRef, 'cs_test_123');
    assert.equal(response.checkoutUrl, 'https://checkout.stripe.com/c/pay/abc');
    assert.equal(response.pixQrCode, null);
    assert.ok(response.expiresAt instanceof Date);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(calls[0].init.headers['Idempotency-Key'], fixture.requestId);
    assert.equal(calls[0].init.headers.authorization, 'Bearer vault-only-stripe-test-secret');
    const params = new URLSearchParams(calls[0].init.body);
    assert.equal(params.get('line_items[0][price_data][unit_amount]'), '12345');
    assert.equal(params.get('line_items[0][price_data][currency]'), 'brl');
    assert.equal(params.get('client_reference_id'), fixture.chargeId);
    assert.equal(params.get('mode'), 'payment');
    assert.doesNotMatch(calls[0].init.body, /cvv|pan|card_number|studentId|vault-only-stripe-test-secret/);
    assert.doesNotMatch(JSON.stringify(response), /vault-only-stripe-test-secret/);
  } finally { globalThis.fetch = old; }
});

test('Stripe checkout rejects invalid redirect and wrong currency before external call', async () => {
  const old = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => { count += 1; throw new Error('unexpected'); };
  try {
    const adapter = new StripeCheckoutAdapter({ register: () => {} });
    await assert.rejects(() => adapter.createCheckout({ ...fixture, currency: 'USD' }), /PAYMENT_AMOUNT_INVALID/);
    await assert.rejects(() => adapter.createCheckout({ ...fixture, publicConfiguration: { successUrl: 'http://unsafe.test', cancelUrl: 'https://academy.test' } }), /STRIPE_REDIRECT_CONFIGURATION_INVALID/);
    assert.equal(count, 0);
  } finally { globalThis.fetch = old; }
});

test('Stripe checkout fails closed on attacker-controlled URL returned by provider', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'cs_test_123', url: 'https://attacker.example/pay',
  }), { status: 200 });
  try {
    const adapter = new StripeCheckoutAdapter({ register: () => {} });
    await assert.rejects(() => adapter.createCheckout(fixture), /STRIPE_CHECKOUT_URL_INVALID/);
  } finally { globalThis.fetch = old; }
});
