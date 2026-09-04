import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FinancialService } = require('../dist/src/modules/financial/financial.service.js');

function basePrisma(overrides = {}) {
  const tx = {
    charge: {
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => null,
      ...overrides.charge,
    },
    student: {
      findFirst: async () => null,
      ...overrides.student,
    },
    subscription: {
      findFirst: async () => null,
      create: async () => ({}),
      ...overrides.subscription,
    },
    financialAccount: {
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => ({}),
      ...overrides.financialAccount,
    },
    financialTransaction: {
      findFirst: async () => null,
      create: async () => ({}),
      ...overrides.financialTransaction,
    },
    gym: {
      findFirst: async () => ({ id: 'gym-a', active: true }),
      ...overrides.gym,
    },
  };

  return {
    ...tx,
    $transaction: async (callback) => callback(tx),
  };
}

test('financial controller derives tenant from authenticated context instead of trusting body gymId', async () => {
  const source = await readFile('src/modules/financial/financial.controller.ts', 'utf8');
  assert.equal(source.includes('resolveTenantOperationGymId'), true);
  assert.equal(source.includes('activeGymId: user.activeGymId ?? user.gymId'), true);
  assert.equal(source.includes('dto.gymId || userGymId'), false);
});

test('financial service never falls back to an unscoped tenant query', async () => {
  const source = await readFile('src/modules/financial/financial.service.ts', 'utf8');
  assert.equal(source.includes('dto.gymId || userGymId'), false);
  assert.equal(source.includes('where: { gymId }'), true);
});

test('charge creation rejects a subscription that is not for the same gym and student', async () => {
  const prisma = basePrisma({
    student: {
      findFirst: async () => ({ id: 'student-a', gymId: 'gym-a' }),
    },
    subscription: {
      findFirst: async () => null,
    },
  });
  prisma.charge.create = async () => {
    throw new Error('charge must not be created');
  };

  const service = new FinancialService(prisma);
  await assert.rejects(
    () =>
      service.createCharge(
        {
          studentId: 'student-a',
          subscriptionId: 'subscription-b',
          amount: 10000,
          dueDate: '2026-09-10T00:00:00.000Z',
        },
        'gym-a',
      ),
    /Assinatura nao encontrada/,
  );
});

test('payCharge is idempotent when charge is already paid and canonical transaction exists', async () => {
  const paidCharge = {
    id: 'charge-a',
    gymId: 'gym-a',
    studentId: 'student-a',
    status: 'PAID',
    amount: 10000,
    paymentMethod: 'PIX',
    student: { id: 'student-a', gymId: 'gym-a' },
    subscription: null,
  };
  const canonicalTransaction = {
    id: 'tx-a',
    gymId: 'gym-a',
    source: 'charge',
    sourceId: 'charge-a',
  };

  let creates = 0;
  const prisma = basePrisma({
    charge: { findFirst: async () => paidCharge },
    financialAccount: {
      findFirst: async () => ({ id: 'account-a', gymId: 'gym-a', active: true }),
    },
    financialTransaction: {
      findFirst: async () => canonicalTransaction,
      create: async () => {
        creates += 1;
        return {};
      },
    },
  });

  const service = new FinancialService(prisma);
  const result = await service.payCharge('charge-a', { accountId: 'account-a' }, 'gym-a');

  assert.equal(result.idempotent, true);
  assert.equal(result.transaction.id, 'tx-a');
  assert.equal(creates, 0);
});

test('payCharge atomically marks charge paid and creates only its canonical income transaction', async () => {
  const charge = {
    id: 'charge-a',
    gymId: 'gym-a',
    studentId: 'student-a',
    status: 'PENDING',
    amount: 10000,
    paymentMethod: null,
    student: { id: 'student-a', gymId: 'gym-a' },
    subscription: null,
  };
  let createdData;
  const prisma = basePrisma({
    charge: {
      findFirst: async () => charge,
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ ...charge, status: 'PAID' }),
    },
    financialAccount: {
      findFirst: async () => ({ id: 'account-a', gymId: 'gym-a', active: true }),
    },
    financialTransaction: {
      findFirst: async () => null,
      create: async ({ data }) => {
        createdData = data;
        return { id: 'tx-a', ...data };
      },
    },
  });

  const service = new FinancialService(prisma);
  const result = await service.payCharge(
    'charge-a',
    { accountId: 'account-a', paymentMethod: 'PIX' },
    'gym-a',
  );

  assert.equal(result.idempotent, false);
  assert.equal(result.charge.status, 'PAID');
  assert.equal(createdData.gymId, 'gym-a');
  assert.equal(createdData.source, 'charge');
  assert.equal(createdData.sourceId, 'charge-a');
  assert.equal(createdData.accountId, 'account-a');
  assert.equal(createdData.amount, 10000);
});

test('payment implementation has serializable transaction and retry protection for concurrency', async () => {
  const source = await readFile('src/modules/financial/financial.service.ts', 'utf8');
  assert.equal(source.includes('Prisma.TransactionIsolationLevel.Serializable'), true);
  assert.equal(source.includes("error.code === 'P2034'"), true);
  assert.equal(source.includes('updateMany({'), true);
  assert.equal(source.includes("source: 'charge'"), true);
  assert.equal(source.includes('sourceId: charge.id'), true);
});
