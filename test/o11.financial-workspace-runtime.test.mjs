import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FinancialService } = require('../dist/src/modules/financial/financial.service.js');

function makePrisma() {
  const calls = {
    subscriptions: [],
    charges: [],
    transactions: [],
  };
  return {
    calls,
    prisma: {
      subscription: {
        findMany: async (args) => {
          calls.subscriptions.push(args);
          return [];
        },
      },
      charge: {
        findMany: async (args) => {
          calls.charges.push(args);
          return [];
        },
      },
      financialTransaction: {
        findMany: async (args) => {
          calls.transactions.push(args);
          return [];
        },
      },
    },
  };
}

test('O11 subscriptions preserve tenant scope while filtering student and status', async () => {
  const { prisma, calls } = makePrisma();
  const service = new FinancialService(prisma);

  await service.findSubscriptions('gym-a', {
    studentId: 'student-a',
    status: 'PAST_DUE',
  });

  assert.deepEqual(calls.subscriptions[0].where, {
    gymId: 'gym-a',
    studentId: 'student-a',
    status: 'PAST_DUE',
  });
});

test('O11 overdue charge filter is canonical PENDING plus due date in the past', async () => {
  const { prisma, calls } = makePrisma();
  const service = new FinancialService(prisma);

  await service.findAllCharges('gym-a', {
    studentId: 'student-a',
    overdue: 'true',
  });

  const where = calls.charges[0].where;
  assert.equal(where.gymId, 'gym-a');
  assert.equal(where.studentId, 'student-a');
  assert.equal(where.status, 'PENDING');
  assert.ok(where.dueDate.lt instanceof Date);
});

test('O11 transaction history is tenant-scoped and supports student/account/status/type/date filters', async () => {
  const { prisma, calls } = makePrisma();
  const service = new FinancialService(prisma);

  await service.findTransactions('gym-a', {
    studentId: 'student-a',
    accountId: 'account-a',
    status: 'PAID',
    type: 'INCOME',
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-30T23:59:59.999Z',
  });

  const query = calls.transactions[0];
  assert.equal(query.where.gymId, 'gym-a');
  assert.equal(query.where.studentId, 'student-a');
  assert.equal(query.where.accountId, 'account-a');
  assert.equal(query.where.status, 'PAID');
  assert.equal(query.where.type, 'INCOME');
  assert.ok(query.where.paidAt.gte instanceof Date);
  assert.ok(query.where.paidAt.lte instanceof Date);
  assert.equal(query.select.account.select.name, true);
});

test('O11 malformed statuses, booleans and reversed date ranges fail before database reads', async () => {
  const { prisma, calls } = makePrisma();
  const service = new FinancialService(prisma);

  await assert.rejects(
    () => service.findSubscriptions('gym-a', { status: 'UNKNOWN' }),
    /Status da assinatura invalido/,
  );
  await assert.rejects(
    () => service.findAllCharges('gym-a', { overdue: 'yes' }),
    /overdue deve ser true ou false/,
  );
  await assert.rejects(
    () => service.findTransactions('gym-a', {
      from: '2026-10-01',
      to: '2026-09-01',
    }),
    /Data inicial nao pode ser posterior/,
  );

  assert.equal(calls.subscriptions.length, 0);
  assert.equal(calls.charges.length, 0);
  assert.equal(calls.transactions.length, 0);
});

test('O11 overdue=true rejects incompatible non-pending status', async () => {
  const { prisma, calls } = makePrisma();
  const service = new FinancialService(prisma);

  await assert.rejects(
    () => service.findAllCharges('gym-a', {
      overdue: 'true',
      status: 'PAID',
    }),
    /Filtro de inadimplencia exige cobranca PENDING/,
  );
  assert.equal(calls.charges.length, 0);
});
