import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { StripeCheckoutAdapter } = require('../dist/src/modules/financial/stripe-checkout.adapter.js');
const { MercadoPagoCheckoutAdapter } = require('../dist/src/modules/financial/mercado-pago-checkout.adapter.js');
const { IntegrationSecretValue } = require('../dist/src/modules/integrations/secrets/integration-secret-vault.port.js');

const stripe = {
  chargeId: 'charge-a', providerChargeRef: 'cs_test_abc', amount: 4990,
  currency: 'BRL', environment: 'HOMOLOG', credential: new IntegrationSecretValue('secret-a'),
};
const mp = {
  chargeId: 'charge-b', providerChargeRef: 'pref-b', amount: 4990,
  currency: 'BRL', environment: 'HOMOLOG', credential: new IntegrationSecretValue('secret-b'),
};

test('Stripe independently verifies paid session, exact charge and sandbox environment', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.stripe.com/v1/checkout/sessions/cs_test_abc');
    assert.equal(init.headers.authorization, 'Bearer secret-a');
    return new Response(JSON.stringify({
      id: 'cs_test_abc', client_reference_id: 'charge-a',
      metadata: { iron_charge_id: 'charge-a' }, amount_total: 4990, currency: 'brl',
      mode: 'payment', payment_status: 'paid', status: 'complete', livemode: false,
    }), { status: 200 });
  };
  try {
    const adapter = new StripeCheckoutAdapter({ register: () => {} });
    const result = await adapter.verifyCheckout(stripe);
    assert.equal(result.status, 'PAID');
    assert.equal(result.providerPaymentRef, 'cs_test_abc');
    await assert.rejects(() => adapter.verifyCheckout({ ...stripe, environment: 'PROD' }), /STRIPE_VERIFICATION_MISMATCH/);
  } finally { globalThis.fetch = old; }
});

test('Stripe refuses paid session amount or identity mismatch without financial mutation', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'cs_test_abc', client_reference_id: 'foreign-charge',
    metadata: { iron_charge_id: 'foreign-charge' }, amount_total: 4990, currency: 'brl',
    mode: 'payment', payment_status: 'paid', status: 'complete', livemode: false,
  }), { status: 200 });
  try {
    const adapter = new StripeCheckoutAdapter({ register: () => {} });
    await assert.rejects(() => adapter.verifyCheckout(stripe), /STRIPE_VERIFICATION_MISMATCH/);
  } finally { globalThis.fetch = old; }
});

test('Mercado Pago verifies merchant-scoped payment after separate search and full read', async () => {
  const old = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    assert.equal(init.headers.authorization, 'Bearer secret-b');
    if (String(url).includes('/payments/search')) return new Response(JSON.stringify({
      paging: { total: 1 }, results: [{ id: 12345, external_reference: 'charge-b' }],
    }), { status: 200 });
    return new Response(JSON.stringify({
      id: 12345, external_reference: 'charge-b', transaction_amount: 49.9,
      currency_id: 'BRL', status: 'approved', status_detail: 'accredited',
      amount_refunded: 0, date_approved: '2026-10-29T16:00:00Z',
    }), { status: 200 });
  };
  try {
    const adapter = new MercadoPagoCheckoutAdapter({ register: () => {} });
    const result = await adapter.verifyCheckout(mp);
    assert.equal(result.status, 'PAID');
    assert.equal(result.providerPaymentRef, '12345');
    assert.equal(urls.length, 2);
    assert.ok(urls[0].includes('external_reference=charge-b'));
    assert.equal(urls[1], 'https://api.mercadopago.com/v1/payments/12345');
  } finally { globalThis.fetch = old; }
});

test('Mercado Pago refuses mismatch and ambiguous merchant payment references', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    paging: { total: 2 }, results: [
      { id: 1, external_reference: 'charge-b' },
      { id: 2, external_reference: 'charge-b' },
    ],
  }), { status: 200 });
  try {
    const adapter = new MercadoPagoCheckoutAdapter({ register: () => {} });
    await assert.rejects(() => adapter.verifyCheckout(mp), /PAYMENT_VERIFICATION_AMBIGUOUS/);
  } finally { globalThis.fetch = old; }
});
