import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ResendEmailAdapter } = require('../dist/src/modules/transactional-email/resend-email.adapter.js');
const { MercadoPagoCheckoutAdapter } = require('../dist/src/modules/financial/mercado-pago-checkout.adapter.js');
const { IntegrationSecretValue } = require('../dist/src/modules/integrations/secrets/integration-secret-vault.port.js');

test('transactional Resend adapter sends idempotent mail using Vault secret without logging secret', async () => {
  const old = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ id: 'email-001' }), { status: 200 });
  };
  try {
    const registrations = [];
    const adapter = new ResendEmailAdapter({ register: (a) => registrations.push(a) });
    adapter.onModuleInit();
    assert.equal(registrations[0], adapter);
    const value = await adapter.dispatch({
      dispatchKey: 'message-001', recipient: 'example@sample.test',
      subject: 'Confirmacao', textBody: 'Texto', htmlBody: '<p>Texto</p>',
      publicConfiguration: { from: 'no-reply@sample.test' },
      credential: new IntegrationSecretValue('vault-only-token'),
    });
    assert.equal(value.providerMessageRef, 'email-001');
    assert.equal(requests.length, 1);
    assert.equal(String(requests[0].url), 'https://api.resend.com/emails');
    assert.equal(requests[0].init.headers['Idempotency-Key'], 'message-001');
    assert.equal(requests[0].init.headers.authorization, 'Bearer vault-only-token');
    assert.deepEqual(JSON.parse(requests[0].init.body).to, ['example@sample.test']);
    assert.equal(JSON.stringify(value).includes('vault-only-token'), false);
  } finally { globalThis.fetch = old; }
});

test('Resend invalid sender fails closed without reaching provider', async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('unexpected'); };
  try {
    const adapter = new ResendEmailAdapter({ register: () => {} });
    await assert.rejects(() => adapter.dispatch({
      dispatchKey: 'message-001', recipient: 'ok@sample.test',
      subject: 'Hello', textBody: 'Text', htmlBody: '<p>Text</p>',
      publicConfiguration: { from: 'invalid' },
      credential: new IntegrationSecretValue('secret'),
    }), { code: 'EMAIL_SENDER_INVALID' });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = old; }
});

test('Mercado Pago adapter creates hosted checkout with stable request id, no PAN/CVV', async () => {
  const old = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ id: 'preference-123', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect' }), { status: 201 });
  };
  try {
    const registry = [];
    const adapter = new MercadoPagoCheckoutAdapter({ register: (a) => registry.push(a) });
    adapter.onModuleInit();
    assert.equal(registry[0], adapter);
    const result = await adapter.createCheckout({
      requestId: '11111111-1111-4111-8111-111111111111',
      chargeId: '22222222-2222-4222-8222-222222222222',
      studentId: '33333333-3333-4333-8333-333333333333',
      amount: 10990, currency: 'BRL', dueDate: null, publicConfiguration: {},
      credential: new IntegrationSecretValue('tenant-payment-secret'),
    });
    assert.equal(result.providerChargeRef, 'preference-123');
    assert.equal(result.pixQrCode, null);
    assert.equal(requests.length, 1);
    assert.equal(String(requests[0].url), 'https://api.mercadopago.com/checkout/preferences');
    assert.equal(requests[0].init.headers['X-Idempotency-Key'], '11111111-1111-4111-8111-111111111111');
    const payload = JSON.parse(requests[0].init.body);
    assert.equal(payload.items[0].unit_price, 109.9);
    assert.equal(payload.external_reference, '22222222-2222-4222-8222-222222222222');
    assert.equal(JSON.stringify(payload).includes('tenant-payment-secret'), false);
    assert.equal(JSON.stringify(payload).includes('studentId'), false);
  } finally { globalThis.fetch = old; }
});

test('Mercado Pago rejects invalid currency, amount and untrusted redirect', async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: 'x', init_point: 'https://attacker.example/collect' }), { status: 201 });
  };
  try {
    const adapter = new MercadoPagoCheckoutAdapter({ register: () => {} });
    const baseline = {
      requestId: '123e4567-e89b-42d3-a456-426614174000',
      chargeId: '123e4567-e89b-42d3-a456-426614174001',
      studentId: '123e4567-e89b-42d3-a456-426614174002',
      amount: 1000, currency: 'BRL', dueDate: null, publicConfiguration: {},
      credential: new IntegrationSecretValue('secret'),
    };
    await assert.rejects(() => adapter.createCheckout({ ...baseline, currency: 'USD' }));
    await assert.rejects(() => adapter.createCheckout({ ...baseline, amount: -1 }));
    assert.equal(calls, 0);
    await assert.rejects(() => adapter.createCheckout(baseline));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = old; }
});
