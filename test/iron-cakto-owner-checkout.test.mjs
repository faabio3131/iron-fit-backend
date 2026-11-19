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
  assert.deepEqual(query.where, { gymId });
  assert.deepEqual(query.select, { id: true, status: true, effectiveUntil: true });
  return { id: subscriptionId, status: 'ACTIVE', effectiveUntil: null };
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
      subscription: { planCode: 'IRON_PRO_MONTHLY', status: 'pending', paidThrough: null,
        nextPaymentAt: '2026-12-17T00:00:00.000Z', scheduleObservedAt: '2026-11-17T15:00:00.000Z',
        caktoManagementAvailable: true, scheduleAnchor: 'must-not-leak' },
      historyTruncated: true,
      invoices: [{ status: 'pending', amountMinor: 26900, currency: 'BRL', periodEnd: null,
        createdAt: '2026-11-17T14:00:00.000Z', recordedPaymentStatus: 'received',
        paymentRecordedAt: '2026-11-17T14:30:00.000Z', externalPaymentId: 'must-not-leak' }],
    }), { status: 200 });
  };
  try {
    const service = new IronCommercialCheckoutService(prisma);
    const result = await service.readCurrent(gymId);
    assert.equal(result.source, 'FM_COMMAND_CANONICAL');
    assert.equal(result.subscription.status, 'pending');
    assert.equal(result.subscription.nextPaymentAt, '2026-12-17T00:00:00.000Z');
    assert.equal(result.subscription.scheduleObservedAt, '2026-11-17T15:00:00.000Z');
    assert.equal(result.subscription.caktoManagementAvailable, true);
    assert.equal(Object.hasOwn(result.subscription, 'scheduleAnchor'), false);
    assert.equal(result.invoices[0].amountMinor, 26900);
    assert.equal(result.historyTruncated, true);
    assert.equal(result.invoices[0].recordedPaymentStatus, 'received');
    assert.equal(result.invoices[0].createdAt, '2026-11-17T14:00:00.000Z');
    assert.equal(result.invoices[0].paymentRecordedAt, '2026-11-17T14:30:00.000Z');
    assert.equal(Object.hasOwn(result.invoices[0], 'externalPaymentId'), false);
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

const expired = new Date('2025-11-17T00:00:00.000Z');
const future = new Date('2099-11-17T00:00:00.000Z');
function suspendedTrialFixture({
  status = 'SUSPENDED', effectiveUntil = expired, trial = true, audit = 'COMMERCIAL_TRIAL_EXPIRED',
} = {}) {
  return {
    tenantProductSubscription: {findFirst: async (query) => {
      assert.deepEqual(query.where, { gymId });
      return {id:subscriptionId,status,effectiveUntil};
    }},
    commercialTrialProvisioning: {findFirst: async (query) => {
      assert.deepEqual(query.where.gymId, gymId);
      assert.equal(query.where.subscriptionId, subscriptionId);
      assert.ok(query.where.trialEndsAt.lte instanceof Date);
      return trial ? {subscriptionId} : null;
    }},
    auditLog: {findFirst: async (query) => {
      assert.equal(query.where.gymId, gymId);
      assert.equal(query.where.entityId, subscriptionId);
      return audit ? {action:audit} : null;
    }},
  };
}

test('expired trial with canonical expiry audit can prepare checkout but never activate entitlement', async () => {
  const restore = setEnv(), previous = globalThis.fetch;
  let prepared = false;
  globalThis.fetch = async (url, init) => {
    prepared = true;
    assert.equal(init.method,'POST');
    assert.equal(JSON.parse(init.body).expectedSubscriptionId,subscriptionId);
    return new Response(JSON.stringify({
      checkoutUrl: 'https://pay.cakto.com.br/official-offer?sck='+invoiceId,
      invoiceId, productCode:'IRON_FIT_CORE',
    }),{status:200});
  };
  try {
    const service = new IronCommercialCheckoutService(suspendedTrialFixture());
    const result = await service.prepare(gymId,'IRON_PRO',requestId);
    assert.equal(prepared,true);
    assert.equal(result.pendingConfirmation,true);
    assert.equal(Object.hasOwn(result,'paid'),false);
    assert.equal(Object.hasOwn(result,'entitlementStatus'),false);
  } finally {globalThis.fetch=previous;restore();}
});

test('non-trial/admin/canceled/future suspended records fail closed before calling FM Command', async () => {
  const restore=setEnv(),previous=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('Forbidden: should fail before external call');};
  const cases=[
    suspendedTrialFixture({trial:false}),
    suspendedTrialFixture({audit:'ADMIN_SUSPENDED'}),
    suspendedTrialFixture({audit:null}),
    suspendedTrialFixture({status:'CANCELED'}),
    suspendedTrialFixture({effectiveUntil:future}),
  ];
  try {
    for (const prisma of cases) {
      const service=new IronCommercialCheckoutService(prisma);
      await assert.rejects(()=>service.prepare(gymId,'IRON_PRO',requestId),
        e=>e.getStatus?.()===409);
    }
  } finally {globalThis.fetch=previous;restore();}
});


test('receipt resend uses authenticated gym, actor and original invoice, never a recipient or payment mutation',async()=>{
  const restore=setEnv(),oldFetch=globalThis.fetch;
  const actorId=randomUUID();
  const service=new IronCommercialCheckoutService({tenantProductSubscription:{findFirst:async query=>{
    assert.deepEqual(query.where,{gymId});return{id:subscriptionId};
  }}});
  let calls=0;
  globalThis.fetch=async(url,init)=>{
    calls++;
    assert.equal(url,'https://app.fmcommand.com.br/api/internal/iron/commerce/receipt');
    assert.equal(init.method,'POST');
    assert.deepEqual(JSON.parse(init.body),{gymId,expectedSubscriptionId:subscriptionId,invoiceId,actorId,requestId});
    return new Response(JSON.stringify({productCode:'IRON_FIT_CORE',provider:'CAKTO',status:'EMAIL_RESEND_ACCEPTED',deliveryConfirmed:false}),{status:200});
  };
  try{
    assert.deepEqual(await service.resendReceipt(gymId,actorId,invoiceId,requestId),
      {provider:'CAKTO',status:'EMAIL_RESEND_ACCEPTED',deliveryConfirmed:false});
    await assert.rejects(()=>service.resendReceipt(gymId,actorId,'forged',requestId),e=>e.getStatus?.()===400);
    assert.equal(calls,1);
    globalThis.fetch=async()=>new Response('{}',{status:429});
    await assert.rejects(()=>service.resendReceipt(gymId,actorId,invoiceId,requestId),e=>e.getStatus?.()===429);
    globalThis.fetch=async()=>new Response(JSON.stringify({productCode:'IRON_FIT_CORE',provider:'CAKTO',status:'EMAIL_RESEND_ACCEPTED',deliveryConfirmed:true}),{status:200});
    await assert.rejects(()=>service.resendReceipt(gymId,actorId,invoiceId,requestId),e=>e.getStatus?.()===503);
  }finally{globalThis.fetch=oldFetch;restore();}
});
