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
      create: async () => ({}),
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
    fiscalHandoff: {
      findUnique: async () => null,
      create: async ({ data }) => ({
        id: 'fiscal-handoff-a',
        status: 'PENDING_CAPABILITY',
        ...data,
      }),
      ...overrides.fiscalHandoff,
    },
    auditLog: {
      create: async ({ data }) => ({ id: 'audit-a', ...data }),
      ...overrides.auditLog,
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

  const subscriptions = source.slice(
    source.indexOf('async findSubscriptions'),
    source.indexOf('async createCharge'),
  );
  const charges = source.slice(
    source.indexOf('async findAllCharges'),
    source.indexOf('async findTransactions'),
  );
  const transactions = source.slice(
    source.indexOf('async findTransactions'),
    source.lastIndexOf('}'),
  );

  assert.equal(subscriptions.includes('gymId,'), true);
  assert.equal(charges.includes('gymId,'), true);
  assert.equal(transactions.includes('gymId,'), true);
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
    subscriptionId: null,
    status: 'PAID',
    amount: 10000,
    paidAt: new Date('2026-09-13T12:00:00.000Z'),
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
  assert.equal(result.fiscalHandoff.state, 'PENDING_CAPABILITY');
  assert.equal(result.fiscalHandoff.idempotencyKey, 'iron:charge:charge-a:nfse:v1');
  assert.equal(result.fiscalHandoffRecordId, 'fiscal-handoff-a');
  assert.equal(creates, 0);
});

test('payCharge atomically marks charge paid, audits it and records governed fiscal handoff', async () => {
  const charge = {
    id: 'charge-a',
    gymId: 'gym-a',
    studentId: 'student-a',
    subscriptionId: 'subscription-a',
    status: 'PENDING',
    amount: 10000,
    paymentMethod: null,
    paidAt: null,
    student: { id: 'student-a', gymId: 'gym-a' },
    subscription: { id: 'subscription-a', gymId: 'gym-a', studentId: 'student-a' },
  };
  let createdData;
  const auditRecords = [];
  const prisma = basePrisma({
    charge: {
      findFirst: async () => charge,
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({
        ...charge,
        status: 'PAID',
        paidAt: new Date('2026-09-13T12:00:00.000Z'),
        paymentMethod: 'PIX',
      }),
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
    auditLog: {
      create: async ({ data }) => {
        auditRecords.push(data);
        return { id: `audit-${auditRecords.length}`, ...data };
      },
    },
  });

  const service = new FinancialService(prisma);
  const result = await service.payCharge(
    'charge-a',
    { accountId: 'account-a', paymentMethod: 'PIX' },
    'gym-a',
    'actor-a',
  );

  assert.equal(result.idempotent, false);
  assert.equal(result.charge.status, 'PAID');
  assert.equal(createdData.gymId, 'gym-a');
  assert.equal(createdData.source, 'charge');
  assert.equal(createdData.sourceId, 'charge-a');
  assert.equal(createdData.accountId, 'account-a');
  assert.equal(createdData.amount, 10000);

  const financialAudit = auditRecords.find((item) => item.action === 'FINANCIAL_CHARGE_PAID');
  const fiscalAudit = auditRecords.find((item) => item.action === 'FISCAL_HANDOFF_PENDING_CAPABILITY');
  assert.ok(financialAudit);
  assert.ok(fiscalAudit);
  assert.equal(financialAudit.gymId, 'gym-a');
  assert.equal(financialAudit.userId, 'actor-a');
  assert.equal(fiscalAudit.gymId, 'gym-a');
  assert.equal(fiscalAudit.userId, 'actor-a');

  assert.equal(result.fiscalHandoff.hostNamespace, 'fm.iron');
  assert.equal(result.fiscalHandoff.packId, 'iron');
  assert.equal(result.fiscalHandoff.useCaseId, 'recurring-membership-billing');
  assert.equal(result.fiscalHandoff.operationKind, 'recurring_charge');
  assert.equal(result.fiscalHandoff.documentKind, 'nfse');
  assert.equal(result.fiscalHandoff.state, 'PENDING_CAPABILITY');
  assert.equal(result.fiscalHandoff.readinessRequiredBeforeIssuance, true);
  assert.equal(result.fiscalHandoff.fiscalScopeBindingRequired, true);
  assert.equal(result.fiscalHandoff.capabilitiesPath, '/v1/capabilities/query');
  assert.equal(result.fiscalHandoff.issuancePath, '/v1/issuances');
  assert.equal(result.fiscalHandoff.idempotencyKey, 'iron:charge:charge-a:nfse:v1');
  assert.equal(result.fiscalHandoff.source.transactionId, 'tx-a');
  assert.equal(result.fiscalHandoff.source.amountMinor, 10000);
  assert.equal(result.fiscalHandoffRecordId, 'fiscal-handoff-a');
});

test('fiscal handoff does not declare production readiness, provider or jurisdiction', async () => {
  const source = await readFile('src/modules/financial/iron-fiscal-handoff.ts', 'utf8');
  assert.equal(source.includes("'PENDING_CAPABILITY'"), true);
  assert.equal(source.includes('readinessRequiredBeforeIssuance: true'), true);
  assert.equal(source.includes('fiscalScopeBindingRequired: true'), true);
  assert.equal(source.includes('PRODUCTION_APPROVED'), false);
  assert.equal(source.includes('providerId'), false);
  assert.equal(source.includes('municipalityCode'), false);
});

test('payment implementation has serializable transaction, DB uniqueness and retry protection for concurrency', async () => {
  const source = await readFile('src/modules/financial/financial.service.ts', 'utf8');
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  assert.equal(source.includes('Prisma.TransactionIsolationLevel.Serializable'), true);
  assert.equal(source.includes("error.code === 'P2034'"), true);
  assert.equal(source.includes("error.code === 'P2002'"), true);
  assert.equal(source.includes('updateMany({'), true);
  assert.equal(source.includes("source: 'charge'"), true);
  assert.equal(source.includes('sourceId: charge.id'), true);
  assert.equal(schema.includes('@@unique([gymId, source, sourceId])'), true);
});
