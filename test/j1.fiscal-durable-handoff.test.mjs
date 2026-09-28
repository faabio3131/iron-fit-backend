import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  materializeIronFiscalHandoff,
} = require(
  '../dist/src/modules/financial/fiscal-handoff.persistence.js',
);

function input(overrides = {}) {
  return {
    gymId: 'gym-a',
    chargeId: 'charge-a',
    transactionId: 'tx-a',
    studentId: 'student-a',
    subscriptionId: 'subscription-a',
    amount: 26900,
    paidAt: new Date('2026-09-28T12:00:00.000Z'),
    paymentMethod: 'PIX',
    ...overrides,
  };
}

test('J1 materializes paid charge as durable provider-neutral fiscal handoff', async () => {
  let created = null;
  const tx = {
    fiscalHandoff: {
      findUnique: async () => null,
      create: async ({ data }) => {
        created = data;
        return {
          id: 'fiscal-a',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
  };

  const result = await materializeIronFiscalHandoff(tx, input());

  assert.equal(result.idempotent, false);
  assert.equal(result.record.id, 'fiscal-a');
  assert.equal(created.status, 'PENDING_CAPABILITY');
  assert.equal(created.gymId, 'gym-a');
  assert.equal(created.chargeId, 'charge-a');
  assert.equal(created.transactionId, 'tx-a');
  assert.equal(created.idempotencyKey, 'iron:charge:charge-a:nfse:v1');
  assert.equal(created.hostNamespace, 'fm.iron');
  assert.equal(created.packId, 'iron');
  assert.equal(created.useCaseId, 'recurring-membership-billing');
  assert.equal(created.operationKind, 'recurring_charge');
  assert.equal(created.documentKind, 'nfse');
  assert.equal(created.amountMinor, 26900);
  assert.equal(created.currency, 'BRL');
  assert.equal(created.paymentMethod, 'PIX');
  assert.equal(
    created.settledAt.toISOString(),
    '2026-09-28T12:00:00.000Z',
  );
});

test('J1 replay returns exact immutable fiscal fact instead of creating duplicate', async () => {
  let creates = 0;
  const existing = {
    id: 'fiscal-a',
    gymId: 'gym-a',
    chargeId: 'charge-a',
    transactionId: 'tx-a',
    idempotencyKey: 'iron:charge:charge-a:nfse:v1',
    contractVersion: 'v1',
    hostNamespace: 'fm.iron',
    packId: 'iron',
    useCaseId: 'recurring-membership-billing',
    operationKind: 'recurring_charge',
    documentKind: 'nfse',
    amountMinor: 26900,
    currency: 'BRL',
    paymentMethod: 'PIX',
    settledAt: new Date('2026-09-28T12:00:00.000Z'),
    status: 'PENDING_CAPABILITY',
  };
  const tx = {
    fiscalHandoff: {
      findUnique: async () => existing,
      create: async () => {
        creates += 1;
        return {};
      },
    },
  };

  const result = await materializeIronFiscalHandoff(tx, input());

  assert.equal(result.idempotent, true);
  assert.equal(result.record.id, 'fiscal-a');
  assert.equal(creates, 0);
});

test('J1 fails closed when existing fiscal handoff diverges from canonical paid fact', async () => {
  const tx = {
    fiscalHandoff: {
      findUnique: async () => ({
        id: 'fiscal-a',
        gymId: 'gym-a',
        chargeId: 'charge-a',
        transactionId: 'tx-a',
        idempotencyKey: 'iron:charge:charge-a:nfse:v1',
        contractVersion: 'v1',
        hostNamespace: 'fm.iron',
        packId: 'iron',
        useCaseId: 'recurring-membership-billing',
        operationKind: 'recurring_charge',
        documentKind: 'nfse',
        amountMinor: 999,
        currency: 'BRL',
        paymentMethod: 'PIX',
        settledAt: new Date('2026-09-28T12:00:00.000Z'),
        status: 'PENDING_CAPABILITY',
      }),
      create: async () => {
        throw new Error('must not create');
      },
    },
  };

  await assert.rejects(
    () => materializeIronFiscalHandoff(tx, input()),
    /diverge do fato financeiro canonico/,
  );
});

test('J1 schema persists orchestration metadata without fiscal provider credential or readiness claim', async () => {
  const [schema, migration, handoff, persistence] = await Promise.all([
    readFile('prisma/schema.prisma', 'utf8'),
    readFile(
      'prisma/migrations/20260928130000_fiscal_handoff_state/migration.sql',
      'utf8',
    ),
    readFile(
      'src/modules/financial/iron-fiscal-handoff.ts',
      'utf8',
    ),
    readFile(
      'src/modules/financial/fiscal-handoff.persistence.ts',
      'utf8',
    ),
  ]);

  const fiscalBlock = schema.slice(
    schema.indexOf('model FiscalHandoff'),
    schema.indexOf('model CommunicationTemplate'),
  );
  assert.match(fiscalBlock, /idempotencyKey\s+String\s+@unique/);
  assert.match(fiscalBlock, /PENDING_CAPABILITY/);
  assert.doesNotMatch(
    fiscalBlock,
    /secretReference|secretValue|privateKey|clientSecret|apiKey/i,
  );
  assert.doesNotMatch(
    migration,
    /secretReference|secretValue|privateKey|clientSecret|apiKey/i,
  );
  assert.match(handoff, /readinessRequiredBeforeIssuance: true/);
  assert.match(handoff, /fiscalScopeBindingRequired: true/);
  assert.doesNotMatch(handoff, /PRODUCTION_APPROVED/);
  assert.match(persistence, /FiscalHandoffStatus\.PENDING_CAPABILITY/);
});
