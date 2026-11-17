import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { IronCommercialCheckoutService } = require('../dist/src/modules/commercial/iron-commercial-checkout.service.js');

const gymId = randomUUID();
const subscriptionId = randomUUID();
const invoiceId = randomUUID();
const requestId = randomUUID();
const URL_KEY = 'IRON_FMCC_COMMERCE_URL';
const TOKEN_KEY = 'IRON_FMCC_COMMERCE_TOKEN';
const active = { tenantProductSubscription: { findFirst: async (query) => {
  assert.equal(query.where.gymId, gymId);
  assert.equal(query.where.status, 'ACTIVE');
  return { id: subscriptionId };
}}};

function setEnv() {
  const previous = { url: process.env[URL_KEY], token: process.env[TOKEN_KEY] };
  process.env[URL_KEY] = 'https://app.fmcommand.com.br/api/internal/iron/commerce/checkout';
  process.env[TOKEN_KEY] = 'isolated-ci-iron-command-' + 'k'.repeat(45);
  return () => {
    if (previous.url === undefined) delete process.env[URL_KEY]; else process.env[URL_KEY] = previous.url;
    if (previous.token === undefined) delete process.env[TOKEN_KEY]; else process.env[TOKEN_KEY] = previous.token;
  };
}

test('OWNER checkout requires current canonical IRON gym and does not grant access by redirect', async () => {
  const restore = setEnv();
  const oldFetch = globalThis.fetch;
  let posted = false;
  globalThis.fetch = async (url, init) => {
    posted = true;
    assert.equal(url, process.env[URL_KEY]);
    assert.equal(init.method, 'POST');
    assert.ok(init.headers.Authorization.startsWith('Bearer isolated-ci-iron-command-'));
    assert.deepEqual(JSON.parse(init.body), {
      gymId, expectedSubscriptionId: subscriptionId, planCode: 'IRON_PRO', idempotencyKey: requestId,
    });
    return new Response(JSON.stringify({
      checkoutUrl: 'https://pay.cakto.com.br/official-offer?sck=' + invoiceId,
      invoiceId, productCode: 'IRON_FIT_CORE',
    }), { status: 200 });
  };
  try {
    const service = new IronCommercialCheckoutService(active);
    const checkout = await service.prepare(gymId, 'IRON_PRO', requestId);
    assert.equal(posted, true);
    assert.equal(checkout.provider, 'CAKTO');
    assert.equal(checkout.pendingConfirmation, true);
    assert.ok(!Object.hasOwn(checkout, 'entitlementStatus'));
    assert.ok(!Object.hasOwn(checkout, 'paid'));
    assert.ok(!Object.hasOwn(checkout, 'invoiceId'));
    assert.equal(checkout.checkoutUrl, 'https://pay.cakto.com.br/official-offer?sck=' + invoiceId);
  } finally { globalThis.fetch = oldFetch; restore(); }
});

test('checkout refuses URL spoofing, fake invoice links, unconfigured provider or missing trial', async () => {
  const restore = setEnv(), oldFetch = globalThis.fetch;
  try {
    const service = new IronCommercialCheckoutService(active);
    for (const [checkoutUrl, expected] of [
      ['https://pay.cakto.com.br/official-offer?sck=' + randomUUID(), 503],
      ['https://pay.cakto.com.br.evil.example/purchase?sck=' + invoiceId, 503],
      ['https://pay.cakto.com.br/official-offer', 503],
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ invoiceId, productCode: 'IRON_FIT_CORE', checkoutUrl }), { status: 200 });
      await assert.rejects(() => service.prepare(gymId, 'IRON_PRO', requestId), (e) => e.getStatus?.() === expected);
    }
    await assert.rejects(() => service.prepare(gymId, '../BAD', requestId), (e) => e.getStatus?.() === 400);
    const noTrial = new IronCommercialCheckoutService({tenantProductSubscription:{findFirst:async()=>null}});
    await assert.rejects(() => noTrial.prepare(gymId, 'IRON_PRO', requestId), (e) => e.getStatus?.() === 409);
    delete process.env[TOKEN_KEY];
    await assert.rejects(() => service.prepare(gymId, 'IRON_PRO', requestId), (e) => e.getStatus?.() === 503);
  } finally { globalThis.fetch = oldFetch; restore(); }
});

test('canonical Command subscription readback is scoped to the current gym and does not imply payment', async () => {
  const restore = setEnv(), oldFetch = globalThis.fetch;
  const prisma = { tenantProductSubscription: { findFirst: async (query) => {
    assert.deepEqual(query.where, { gymId });
    assert.equal(query.select.id, true);
    assert.equal(query.orderBy.effectiveFrom, 'desc');
    return { id: subscriptionId };
  }}};
  globalThis.fetch = async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin + target.pathname, 'https://app.fmcommand.com.br/api/internal/iron/commerce/subscription');
    assert.equal(target.searchParams.get('gymId'), gymId);
    assert.equal(target.searchParams.get('expectedSubscriptionId'), subscriptionId);
    assert.equal(init.method, 'GET');
    assert.ok(init.headers.Authorization.startsWith('Bearer isolated-ci-iron-command-'));
    return new Response(JSON.stringify({
      source: 'FM_COMMAND_CANONICAL', authority: 'FM_COMMAND', productCode: 'IRON_FIT_CORE',
      gymId, checkedAt: '2026-11-17T15:00:00.000Z', settlementConfirmedByThisView: false,
      subscription: { planCode: 'IRON_PRO_MONTHLY', status: 'pending', paidThrough: null },
      invoices: [{ status: 'pending', amountMinor: 26900, currency: 'BRL', periodEnd: null }],
    }), { status: 200 });
  };
  try {
    const service = new IronCommercialCheckoutService(prisma);
    const result = await service.readCurrent(gymId);
    assert.equal(result.source, 'FM_COMMAND_CANONICAL');
    assert.equal(result.subscription.status, 'pending');
    assert.equal(result.invoices[0].amountMinor, 26900);
    assert.equal(result.settlementConfirmedByThisView, false);
    assert.equal(Object.hasOwn(result, 'paid'), false);
    assert.equal(Object.hasOwn(result, 'entitlement'), false);
  } finally { globalThis.fetch = oldFetch; restore(); }
});

test('Command readback rejects foreign gym or malformed paid facts; never uses local billing as truth', async () => {
  const restore = setEnv(), oldFetch = globalThis.fetch;
  const prisma = { tenantProductSubscription: { findFirst: async () => ({ id: subscriptionId }) }};
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      source: 'FM_COMMAND_CANONICAL', authority: 'FM_COMMAND', productCode: 'IRON_FIT_CORE',
      gymId: randomUUID(), checkedAt: '2026-11-17T15:00:00.000Z',
      settlementConfirmedByThisView: false, subscription: null, invoices: [],
    }), {status:200});
    const service = new IronCommercialCheckoutService(prisma);
    await assert.rejects(() => service.readCurrent(gymId), (e) => e.getStatus?.() === 503);
    globalThis.fetch = async () => new Response(JSON.stringify({
      source: 'FM_COMMAND_CANONICAL', authority: 'FM_COMMAND', productCode: 'IRON_FIT_CORE',
      gymId, checkedAt: '2026-11-17T15:00:00.000Z',
      settlementConfirmedByThisView: false, subscription: null,
      invoices: [{ status: 'paid', amountMinor: '26900', currency:'BRL', periodEnd:null }],
    }), {status:200});
    await assert.rejects(() => service.readCurrent(gymId), (e) => e.getStatus?.() === 503);
    await assert.rejects(() => service.readCurrent('foreign'), (e) => e.getStatus?.() === 400);
  } finally { globalThis.fetch = oldFetch; restore(); }
});
