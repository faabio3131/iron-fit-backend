import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { TenantPaymentReconciliationService } = require('../dist/src/modules/financial/tenant-payment-reconciliation.service.js');
const { IntegrationSecretValue } = require('../dist/src/modules/integrations/secrets/integration-secret-vault.port.js');

function fixture({ status = 'PAID', connection = true, chargeGym = 'gym-a', verifiedPaymentRef = 'payment-a' } = {}) {
  const calls = { payments: [], audits: [], resolved: [], lookups: [] };
  const charge = {
    id: 'charge-a', gymId: chargeGym, gatewayProviderCode: 'stripe',
    gatewayConnectionId: 'connection-a', gatewayChargeId: 'cs_test_a',
    gatewayRequestId: 'request-a', status: 'PENDING', amount: 5000,
  };
  const service = new TenantPaymentReconciliationService(
    {
      charge: { findFirst: async ({ where }) => where.gymId === charge.gymId ? charge : null },
      integrationConnection: {
        findFirst: async ({ where }) => {
          calls.lookups.push(where);
          if (!connection || where.gymId !== 'gym-a' || where.id !== 'connection-a') return null;
          return { id: 'connection-a', providerCode: 'stripe' };
        },
      },
    },
    { current: () => 'HOMOLOG' },
    {
      resolveForExternalBoundary: async (connectionId, scope) => {
        calls.resolved.push({ connectionId, scope });
        return new IntegrationSecretValue('vault-secret-only');
      },
    },
    {
      require: (provider) => {
        assert.equal(provider, 'stripe');
        return { verifyCheckout: async (input) => {
          assert.equal(input.chargeId, 'charge-a');
          assert.equal(input.providerChargeRef, 'cs_test_a');
          assert.equal(input.amount, 5000);
          assert.equal(input.currency, 'BRL');
          assert.equal(input.environment, 'HOMOLOG');
          return { status, providerPaymentRef: verifiedPaymentRef, paidAt: null };
        } };
      },
    },
    {
      payCharge: async (chargeId, dto, gymId, userId) => {
        calls.payments.push({ chargeId, dto, gymId, userId });
        return { idempotent: false };
      },
    },
    { record: async (entry) => calls.audits.push(entry) },
  );
  return { service, calls };
}

test('settlement requires tenant-specific provider API proof before writing financial ledger', async () => {
  const { service, calls } = fixture();
  const result = await service.reconcile('charge-a', 'account-a', 'gym-a', 'owner-a');
  assert.equal(result.booked, true);
  assert.equal(result.providerPaymentRef, 'payment-a');
  assert.deepEqual(calls.resolved, [{
    connectionId: 'connection-a', scope: { scope: 'TENANT', gymId: 'gym-a' },
  }]);
  assert.equal(calls.lookups[0].gymId, 'gym-a');
  assert.equal(calls.lookups[0].scope, 'TENANT');
  assert.equal(calls.payments.length, 1);
  assert.equal(calls.payments[0].dto.accountId, 'account-a');
  assert.equal(calls.payments[0].dto.paymentMethod, 'GATEWAY_STRIPE');
  assert.equal(calls.audits[0].next.providerPaymentRef, 'payment-a');
  assert.doesNotMatch(JSON.stringify(calls.audits), /vault-secret-only/);
});

test('pending provider status does not mark charge paid or emit receipt audit', async () => {
  const { service, calls } = fixture({ status: 'PENDING' });
  const result = await service.reconcile('charge-a', 'account-a', 'gym-a', 'owner-a');
  assert.equal(result.booked, false);
  assert.equal(calls.payments.length, 0);
  assert.equal(calls.audits.length, 0);
});

test('foreign-tenant charge and missing payment connection never access Vault or ledger', async () => {
  const foreign = fixture({ chargeGym: 'gym-b' });
  await assert.rejects(() => foreign.service.reconcile('charge-a', 'account-a', 'gym-a', 'owner-a'), /Cobranca nao encontrada/);
  assert.equal(foreign.calls.resolved.length, 0);
  const wrong = fixture({ connection: false });
  await assert.rejects(() => wrong.service.reconcile('charge-a', 'account-a', 'gym-a', 'owner-a'), /Conexao de pagamento indisponivel/);
  assert.equal(wrong.calls.payments.length, 0);
  assert.equal(wrong.calls.resolved.length, 0);
});

test('verified status with missing payment reference fails closed', async () => {
  const { service, calls } = fixture({ verifiedPaymentRef: null });
  await assert.rejects(() => service.reconcile('charge-a', 'account-a', 'gym-a', 'owner-a'), /referencia verificavel/);
  assert.equal(calls.payments.length, 0);
});
