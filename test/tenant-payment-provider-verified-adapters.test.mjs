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

test('Stripe verifies session, PaymentIntent and charge before receipt is PAID', async () => {
  const old = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    assert.equal(init.headers.authorization, 'Bearer secret-a');
    if (String(url).includes('/checkout/sessions/')) {
      return new Response(JSON.stringify({
        id: 'cs_test_abc', client_reference_id: 'charge-a',
        metadata: { iron_charge_id: 'charge-a' }, amount_total: 4990, currency: 'brl',
        mode: 'payment', payment_status: 'paid', status: 'complete',
        payment_intent: 'pi_test_abc', livemode: false,
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      id: 'pi_test_abc', currency: 'brl', amount: 4990,
      amount_received: 4990, livemode: false, status: 'succeeded',
      latest_charge: {
        id: 'ch_test_abc', payment_intent: 'pi_test_abc',
        amount: 4990, currency: 'brl', paid: true, status: 'succeeded',
        refunded: false, disputed: false, amount_refunded: 0,
      },
    }), { status: 200 });
  };
  try {
    const adapter = new StripeCheckoutAdapter({ register: () => {} });
    const result = await adapter.verifyCheckout(stripe);
    assert.equal(result.status, 'PAID');
    assert.equal(result.providerPaymentRef, 'pi_test_abc');
    assert.equal(urls.length, 2);
    await assert.rejects(() => adapter.verifyCheckout({ ...stripe, environment: 'PROD' }), /STRIPE_VERIFICATION_MISMATCH/);
  } finally { globalThis.fetch = old; }
});

test('Stripe refuses paid checkout when PaymentIntent has been refunded or disputed', async () => {
  const old = globalThis.fetch;
  for (const variant of [{ refunded: true }, { disputed: true }, { amount_refunded: 100 }]) {
    globalThis.fetch = async (url) => new Response(JSON.stringify(
      String(url).includes('/checkout/sessions/') ? {
        id: 'cs_test_abc', client_reference_id: 'charge-a', metadata: { iron_charge_id: 'charge-a' },
        amount_total: 4990, currency: 'brl', mode: 'payment', payment_status: 'paid',
        status: 'complete', payment_intent: 'pi_test_abc', livemode: false,
      } : {
        id: 'pi_test_abc', currency: 'brl', amount: 4990, amount_received: 4990,
        livemode: false, status: 'succeeded', latest_charge: {
          id: 'ch_test_abc', payment_intent: 'pi_test_abc', amount: 4990,
          currency: 'brl', paid: true, status: 'succeeded',
          refunded: false, disputed: false, amount_refunded: 0, ...variant,
        },
      }), { status: 200 });
    const adapter = new StripeCheckoutAdapter({ register: () => {} });
    assert.equal((await adapter.verifyCheckout(stripe)).status, 'REVERSED');
  }
  globalThis.fetch = old;
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
