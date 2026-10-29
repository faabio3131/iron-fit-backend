import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { FinancialService } = require('../dist/src/modules/financial/financial.service.js');

function fixture({ amount = 5000, status = 'PAID', originalAmount = amount, refundedAlready = false } = {}) {
  let chargeStatus = status;
  let refund = refundedAlready ? { id: 'expense-existing', amount } : null;
  const logs = [];
  let refundCreates = 0;
  const original = {
    id: 'income-a', gymId: 'gym-a', source: 'charge', sourceId: 'charge-a',
    type: 'INCOME', status: 'PAID', amount: originalAmount, accountId: 'account-a',
  };
  const tx = {
    charge: {
      findFirst: async ({ where }) => where.gymId === 'gym-a' ? {
        id: 'charge-a', gymId: 'gym-a', student: { gymId: 'gym-a' },
        gatewayRequestId: 'request-a', gatewayChargeId: 'cs_a',
        gatewayConnectionId: 'connection-a', amount, studentId: 'student-a',
        status: chargeStatus,
      } : null,
      updateMany: async ({ where, data }) => {
        assert.equal(where.gymId, 'gym-a');
        assert.equal(where.status, 'PAID');
        if (chargeStatus !== 'PAID') return { count: 0 };
        chargeStatus = data.status;
        return { count: 1 };
      },
    },
    financialTransaction: {
      findFirst: async ({ where }) => where.source === 'charge' ? original : refund,
      create: async ({ data }) => {
        refundCreates += 1;
        assert.equal(data.type, 'EXPENSE');
        assert.equal(data.source, 'charge_refund');
        assert.equal(data.sourceId, 'charge-a');
        assert.equal(data.amount, 5000);
        assert.equal(data.accountId, 'account-a');
        refund = { id: 'expense-a', ...data };
        return refund;
      },
    },
    auditLog: { create: async ({ data }) => { logs.push(data); return { id: 'audit-a' }; } },
  };
  return {
    service: new FinancialService({ $transaction: async (fn) => fn(tx) }),
    logs,
    getStatus: () => chargeStatus,
    countRefunds: () => refundCreates,
  };
}

const evidence = {
  connectionId: 'connection-a', paymentRef: 'pi_paid_a', refundedAmount: 5000,
};

test('verified full refund records one compensating expense and preserves original income', async () => {
  const fx = fixture();
  const first = await fx.service.refundVerifiedGatewayCharge('charge-a', 'gym-a', 'owner-a', evidence);
  assert.equal(first.idempotent, false);
  assert.equal(first.reversalTransactionId, 'expense-a');
  assert.equal(fx.getStatus(), 'REFUNDED');
  assert.equal(fx.countRefunds(), 1);
  assert.equal(fx.logs.length, 1);
  assert.equal(fx.logs[0].action, 'FINANCIAL_GATEWAY_FULL_REFUND_VERIFIED');
  assert.equal(fx.logs[0].next.fiscalCancellationRequiresSeparateReconciliation, true);
  const replay = await fx.service.refundVerifiedGatewayCharge('charge-a', 'gym-a', 'owner-a', evidence);
  assert.equal(replay.idempotent, true);
  assert.equal(fx.countRefunds(), 1);
  assert.equal(fx.logs.length, 1);
});

test('partial refund and wrong tenant cannot create compensating expense', async () => {
  const fx = fixture();
  await assert.rejects(
    () => fx.service.refundVerifiedGatewayCharge('charge-a', 'gym-a', 'owner-a', {
      ...evidence, refundedAmount: 1000,
    }),
    /comprovacao integral/,
  );
  await assert.rejects(
    () => fx.service.refundVerifiedGatewayCharge('charge-a', 'gym-other', 'owner-other', evidence),
    /Cobranca nao encontrada/,
  );
  assert.equal(fx.getStatus(), 'PAID');
  assert.equal(fx.countRefunds(), 0);
});

test('missing original income, mismatched amount or non-paid charge blocks refund', async () => {
  for (const options of [{ originalAmount: 3000 }, { status: 'PENDING' }]) {
    const fx = fixture(options);
    await assert.rejects(
      () => fx.service.refundVerifiedGatewayCharge('charge-a', 'gym-a', 'owner-a', evidence),
      /Recebimento original|Estado de estorno/,
    );
    assert.equal(fx.countRefunds(), 0);
  }
});
