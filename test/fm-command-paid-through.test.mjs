import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FmCommandControlPlaneService } = require('../dist/src/modules/fm-command/fm-command-control-plane.service.js');

function runService(status, effectiveUntil) {
  const calls = [];
  const current = {
    id: 'sub1', gymId: 'gym1', status, effectiveUntil,
    planVersion: { productPlan: { code: 'IRON_PRO' }, version: 1 },
  };
  const tx = {
    tenantProductSubscription: {
      findFirst: async ({ where }) => {
        assert.equal(where.id, 'sub1');
        assert.equal(where.gymId, 'gym1');
        return { ...current };
      },
      update: async ({ data }) => {
        calls.push(data);
        Object.assign(current, data);
        return { ...current };
      },
    },
  };
  const prisma = { $transaction: async (fn) => fn(tx) };
  const audit = { record: async () => undefined };
  return { service: new FmCommandControlPlaneService(prisma, audit, {}), calls, current };
}
const base = {
  action: 'subscription.status.sync', gymId: 'gym1', expectedSubscriptionId: 'sub1',
  commercialStatus: 'active', entitlementStatus: 'ACTIVE', reason: 'FM verified invoice',
};

test('verified FM payment extends real tenant license beyond trial without shortening other paid periods', async () => {
  const one = runService('SUSPENDED', new Date(Date.now() - 86_400_000));
  const paid = new Date(Date.now() + 28 * 86_400_000).toISOString();
  const r = await one.service.syncStatus({ ...base, paidThrough: paid });
  assert.equal(r.changed, true);
  assert.equal(r.entitlementStatus, 'ACTIVE');
  assert.equal(one.calls.length, 1);
  assert.equal(one.calls[0].effectiveUntil.toISOString(), paid);
  const two = runService('ACTIVE', new Date(Date.now() + 90 * 86_400_000));
  const stale = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const kept = await two.service.syncStatus({ ...base, paidThrough: stale });
  assert.equal(kept.changed, false);
  assert.equal(two.calls.length, 0);
});

test('paidThrough cannot be used to extend suspended/cancelled licenses, expired or implausible periods', async () => {
  const svc = runService('ACTIVE', new Date(Date.now() + 10 * 86_400_000)).service;
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString();
  for (const dto of [
    { ...base, entitlementStatus: 'SUSPENDED', commercialStatus: 'suspended', paidThrough: soon },
    { ...base, paidThrough: 'garbage' },
    { ...base, paidThrough: new Date(Date.now() - 86_400_000).toISOString() },
    { ...base, paidThrough: new Date(Date.now() + 405 * 86_400_000).toISOString() },
  ]) {
    await assert.rejects(() => svc.syncStatus(dto), (err) => err.getStatus?.() === 400);
  }
  const canceled = runService('CANCELED', new Date(Date.now() + 10 * 86_400_000)).service;
  await assert.rejects(() => canceled.syncStatus({ ...base, paidThrough: soon }), (err) => err.getStatus?.() === 409);
});
