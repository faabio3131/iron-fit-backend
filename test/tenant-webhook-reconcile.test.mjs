import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TenantPaymentWebhookReconcileService } =
  require('../dist/src/modules/financial/tenant-payment-webhook-reconcile.service.js');

function fixture({ status = 'RECEIVED', chargeId = 'charge-a',
  providerCode = 'stripe', result = { status: 'PAID', booked: true },
  fail = false, tenant = 'gym-a' } = {}) {
  let currentStatus = status;
  const state = { reconciliation: [], audit: [], writes: [] };
  const event = {
    id: 'event-a', gymId: tenant, providerCode, chargeId,
    providerObjectRef: 'cs_test_a', status,
  };
  const service = new TenantPaymentWebhookReconcileService({
    tenantPaymentWebhookInbox: {
      findFirst: async ({ where }) =>
        where.id === event.id && where.gymId === event.gymId ? { ...event, status: currentStatus } : null,
      updateMany: async ({ where, data }) => {
        if (where.gymId !== event.gymId || where.status !== currentStatus) return { count: 0 };
        currentStatus = data.status;
        state.writes.push(data.status);
        return { count: 1 };
      },
    },
    charge: { findFirst: async ({ where }) => {
      assert.equal(where.gymId, tenant);
      assert.equal(where.gatewayChargeId, 'cs_test_a');
      return { id: chargeId };
    } },
  }, {
    reconcile: async (...args) => {
      state.reconciliation.push(args);
      if (fail) throw new Error('provider unavailable');
      return result;
    },
  }, { record: async (entry) => state.audit.push(entry) });
  return { service, state, getStatus: () => currentStatus };
}

test('signed matched Stripe event can be processed only via verified provider reconciliation', async () => {
  const fx = fixture();
  assert.deepEqual(await fx.service.processEvent('event-a', 'account-a', 'gym-a', 'owner-a'), {
    eventId: 'event-a', status: 'RECONCILED', processed: true,
  });
  assert.deepEqual(fx.state.reconciliation[0], ['charge-a', 'account-a', 'gym-a', 'owner-a']);
  assert.deepEqual(fx.state.writes, ['PROCESSING', 'RECONCILED']);
  assert.equal(fx.state.audit[0].action, 'FINANCIAL_SIGNED_WEBHOOK_RECONCILED');
  const replay = await fx.service.processEvent('event-a', 'account-a', 'gym-a', 'owner-a');
  assert.equal(replay.idempotent, true);
  assert.equal(fx.state.reconciliation.length, 1);
});

test('unlinked Mercado Pago event is manual review only and never books payment', async () => {
  const fx = fixture({ providerCode: 'mercado_pago', chargeId: null, status: 'UNMATCHED' });
  const result = await fx.service.processEvent('event-a', 'account-a', 'gym-a', 'owner-a');
  assert.equal(result.processed, false);
  assert.equal(fx.state.reconciliation.length, 0);
  assert.equal(fx.state.writes.length, 0);
});

test('cross-tenant event cannot be claimed or reconciled', async () => {
  const fx = fixture({ tenant: 'gym-other' });
  await assert.rejects(
    () => fx.service.processEvent('event-a', 'account-a', 'gym-a', 'owner-a'),
    /Evento de pagamento nao encontrado/,
  );
  assert.equal(fx.state.reconciliation.length, 0);
});

test('provider API error safely returns event to retry without recording payment', async () => {
  const fx = fixture({ fail: true });
  await assert.rejects(
    () => fx.service.processEvent('event-a', 'account-a', 'gym-a', 'owner-a'),
    /provider unavailable/,
  );
  assert.equal(fx.getStatus(), 'RETRY');
  assert.deepEqual(fx.state.writes, ['PROCESSING', 'RETRY']);
  assert.equal(fx.state.audit.length, 0);
});

test('unconfirmed payment is not marked reconciled', async () => {
  const fx = fixture({ result: { status: 'PENDING', booked: false } });
  const result = await fx.service.processEvent('event-a', 'account-a', 'gym-a', 'owner-a');
  assert.equal(result.status, 'RETRY');
  assert.equal(fx.getStatus(), 'RETRY');
});

test('verified linked MP event uses canonical provider recheck instead of raw webhook status', async () => {
  const checks = [];
  const service = new TenantPaymentWebhookReconcileService({
    tenantPaymentWebhookInbox: {
      findFirst: async () => ({
        id: 'mp-event', gymId: 'gym-a', providerCode: 'mercado_pago',
        chargeId: 'charge-a', providerObjectRef: '12345', status: 'RECEIVED',
      }),
      updateMany: async () => ({ count: 1 }),
    },
    charge: { findFirst: async ({ where }) => {
      assert.equal(where.gymId, 'gym-a');
      assert.equal(where.gatewayProviderCode, 'mercado_pago');
      assert.equal(where.gatewayChargeId, undefined);
      return { id: 'charge-a' };
    } },
  }, { reconcile: async (...args) => {
    checks.push(args);
    return { status: 'PAID', booked: true };
  } }, { record: async () => {} });
  const result = await service.processEvent('mp-event', 'account-a', 'gym-a', 'owner-a');
  assert.equal(result.status, 'RECONCILED');
  assert.deepEqual(checks[0], ['charge-a', 'account-a', 'gym-a', 'owner-a']);
});
