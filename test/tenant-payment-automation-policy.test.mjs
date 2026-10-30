import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TenantPaymentReconciliationAutomationService } =
  require('../dist/src/modules/financial/tenant-payment-reconciliation-automation.service.js');

function fixture({ accountPresent = true, policyEnabled = true, eventTenant = 'gym-a' } = {}) {
  const state = { calls: [], audits: [], policies: [] };
  const policy = { gymId: 'gym-a', accountId: 'account-a', enabled: policyEnabled };
  const service = new TenantPaymentReconciliationAutomationService({
    financialAccount: { findFirst: async ({ where }) => {
      if (where.gymId !== 'gym-a' || !accountPresent) return null;
      return { id: 'account-a', gymId: 'gym-a', active: true };
    } },
    tenantPaymentReconciliationPolicy: {
      findUnique: async ({ where }) => where.gymId === 'gym-a' ? policy : null,
      upsert: async ({ create }) => { state.policies.push(create); return create; },
    },
    tenantPaymentWebhookInbox: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [{
        id: 'event-a', gymId: eventTenant, providerCode: 'stripe',
        chargeId: 'charge-a', status: 'RECEIVED', attemptCount: 0,
      }],
    },
  }, {
    processEvent: async (...args) => { state.calls.push(args); return { processed: true }; },
  }, {
    record: async (entry) => state.audits.push(entry),
  });
  return { service, state };
}
const old = process.env.IRON_PAYMENT_AUTO_RECONCILE_ENABLED;
after(() => { if (old === undefined) delete process.env.IRON_PAYMENT_AUTO_RECONCILE_ENABLED;
  else process.env.IRON_PAYMENT_AUTO_RECONCILE_ENABLED = old; });

test('automation is always off by default even when a tenant has an enabled policy', async () => {
  delete process.env.IRON_PAYMENT_AUTO_RECONCILE_ENABLED;
  const fx = fixture();
  assert.deepEqual(await fx.service.runCycle(), { processed: 0, disabled: true });
  assert.equal(fx.state.calls.length, 0);
});

test('tenant owner must choose an active financial account before enabling automation', async () => {
  const fx = fixture({ accountPresent: false });
  await assert.rejects(
    () => fx.service.configure('gym-a', 'account-a', true, 'owner-a'),
    /Conta financeira nao encontrada/,
  );
  assert.equal(fx.state.policies.length, 0);
  assert.equal(fx.state.audits.length, 0);
});

test('owner opt-in policy is persisted, audited and contains no credentials', async () => {
  const fx = fixture();
  const config = await fx.service.configure('gym-a', 'account-a', true, 'owner-a');
  assert.deepEqual(config, { gymId: 'gym-a', accountId: 'account-a', enabled: true });
  assert.equal(fx.state.policies[0].updatedByUserId, 'owner-a');
  assert.equal(fx.state.audits[0].action, 'FINANCIAL_AUTOMATED_RECONCILIATION_POLICY_CHANGED');
  assert.doesNotMatch(JSON.stringify(fx.state.audits), /secret|token/i);
});

test('automation runs only for enabled policy with active tenant financial account', async () => {
  process.env.IRON_PAYMENT_AUTO_RECONCILE_ENABLED = 'true';
  const fx = fixture();
  assert.deepEqual(await fx.service.runCycle(), { processed: 1, disabled: false });
  assert.deepEqual(fx.state.calls[0], ['event-a', 'account-a', 'gym-a', undefined]);
  const disabled = fixture({ policyEnabled: false });
  assert.deepEqual(await disabled.service.runCycle(), { processed: 0, disabled: false });
  assert.equal(disabled.state.calls.length, 0);
  const inactiveAccount = fixture({ accountPresent: false });
  assert.deepEqual(await inactiveAccount.service.runCycle(), { processed: 0, disabled: false });
});

test('cross-tenant event cannot inherit another gym automation policy', async () => {
  process.env.IRON_PAYMENT_AUTO_RECONCILE_ENABLED = 'true';
  const fx = fixture({ eventTenant: 'gym-other' });
  assert.equal((await fx.service.runCycle()).processed, 0);
  assert.equal(fx.state.calls.length, 0);
});
