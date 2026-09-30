import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SaasBillingService } = require('../dist/src/modules/saas-billing/saas-billing.service.js');

function serviceFixture({ agreement, policy }) {
  const calls = { invoices: [] };
  const prisma = {
    saasBillingAgreement: {
      findFirst: async () => agreement,
    },
    saasInvoice: {
      findMany: async (args) => {
        calls.invoices.push(args);
        return [{
          id: 'invoice-a',
          agreementId: agreement?.id,
          amountDueMinor: 14990,
          amountPaidMinor: 0,
          status: 'OPEN',
          currency: 'BRL',
          dueAt: new Date('2026-10-05T00:00:00.000Z'),
          payments: [],
          refunds: [],
          price: { id: 'price-a' },
        }];
      },
    },
  };
  const launch = {
    currentApproved: async () => ({ policy }),
  };
  const config = { get: () => undefined };
  const audit = { record: async () => ({}) };
  const lifecycle = {};
  const sandbox = { code: 'INTERNAL_SANDBOX' };

  return {
    service: new SaasBillingService(
      prisma,
      config,
      launch,
      audit,
      lifecycle,
      sandbox,
      undefined,
    ),
    calls,
  };
}

test('O12 current billing read model exposes approved dunning policy and computed grace deadline', async () => {
  const pastDueSince = new Date('2026-09-20T00:00:00.000Z');
  const { service, calls } = serviceFixture({
    agreement: {
      id: 'agreement-a',
      gymId: 'gym-a',
      status: 'PAST_DUE',
      pastDueSince,
      price: { id: 'price-a' },
      productSubscription: { id: 'subscription-a' },
    },
    policy: {
      invoiceDueDays: 5,
      dunningGraceDays: 7,
    },
  });

  const result = await service.getCurrent('gym-a');

  assert.equal(calls.invoices.length, 1);
  assert.equal(result.billingPolicy.invoiceDueDays, 5);
  assert.equal(result.billingPolicy.dunningGraceDays, 7);
  assert.equal(
    result.billingPolicy.gracePeriodEndsAt.toISOString(),
    '2026-09-27T00:00:00.000Z',
  );
});

test('O12 current billing returns no commercial policy when tenant has no billing agreement', async () => {
  const { service, calls } = serviceFixture({
    agreement: null,
    policy: {
      invoiceDueDays: 5,
      dunningGraceDays: 7,
    },
  });

  const result = await service.getCurrent('gym-a');

  assert.deepEqual(result, {
    agreement: null,
    invoices: [],
    billingPolicy: null,
  });
  assert.equal(calls.invoices.length, 0);
});

test('O12 current billing fails closed when approved grace policy is incomplete', async () => {
  const { service } = serviceFixture({
    agreement: {
      id: 'agreement-a',
      gymId: 'gym-a',
      status: 'PAST_DUE',
      pastDueSince: new Date('2026-09-20T00:00:00.000Z'),
      price: { id: 'price-a' },
      productSubscription: { id: 'subscription-a' },
    },
    policy: {
      invoiceDueDays: 5,
      dunningGraceDays: 0,
    },
  });

  await assert.rejects(
    () => service.getCurrent('gym-a'),
    /Politica comercial da Launch Matrix APPROVED incompleta/,
  );
});
