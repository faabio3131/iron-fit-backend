import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  FiscalReconciliationCancellationService,
} = require(
  '../dist/src/modules/financial/fiscal-reconciliation-cancellation.service.js',
);

function serviceFixture(rows = []) {
  const calls = [];
  const prisma = {
    fiscalHandoff: {
      findMany: async (args) => {
        calls.push(args);
        return rows;
      },
    },
  };
  const service = new FiscalReconciliationCancellationService(
    prisma,
    { assertStepUp: async () => undefined },
    {},
    {},
    { record: async () => undefined },
  );
  return { service, calls };
}

test('FISCAL-1 lists handoffs only by canonical tenant and optional canonical status', async () => {
  const fx = serviceFixture([{ id: 'handoff-a', status: 'AUTHORIZED' }]);

  const result = await fx.service.listTenantHandoffs('gym-a', 'authorized');

  assert.equal(result.length, 1);
  assert.equal(fx.calls.length, 1);
  assert.deepEqual(fx.calls[0].where, {
    gymId: 'gym-a',
    status: 'AUTHORIZED',
  });
  assert.equal(fx.calls[0].take, 200);
  assert.deepEqual(fx.calls[0].orderBy, { createdAt: 'desc' });
});

test('FISCAL-1 rejects unknown fiscal status instead of widening the query', async () => {
  const fx = serviceFixture([]);

  await assert.rejects(
    () => fx.service.listTenantHandoffs('gym-a', 'invented'),
    /Status fiscal invalido/,
  );
  assert.equal(fx.calls.length, 0);
});

test('FISCAL-1 read model explicitly excludes fiscal secrets and internal leases', async () => {
  const fx = serviceFixture([]);
  await fx.service.listTenantHandoffs('gym-a');

  const select = fx.calls[0].select;
  for (const forbidden of [
    'providerAccessKey',
    'providerProtocolReference',
    'idempotencyKey',
    'dispatchLeaseOwner',
    'dispatchLeaseUntil',
    'bridgeConnectionId',
  ]) {
    assert.equal(Object.hasOwn(select, forbidden), false, forbidden);
  }

  for (const expected of [
    'status',
    'amountMinor',
    'currency',
    'providerDocumentId',
    'lastErrorCode',
    'authorizedAt',
    'reconciledAt',
    'cancelledAt',
    'reconciliationIssueCodes',
  ]) {
    assert.equal(select[expected], true, expected);
  }
});

test('FISCAL-1 controller route preserves OWNER/SUPER_ADMIN + canonical tenant resolution', async () => {
  const controller = await readFile(
    new URL('../src/modules/financial/financial.controller.ts', import.meta.url),
    'utf8',
  );

  assert.match(controller, /@Get\('fiscal\/handoffs'\)/);
  assert.match(
    controller,
    /@Roles\('SUPER_ADMIN', 'OWNER'\)[\s\S]*?listFiscalHandoffs/,
  );
  assert.match(
    controller,
    /this\.fiscalLifecycle\.listTenantHandoffs\([\s\S]*?this\.resolveGymId\(user, requestedGymId\)/,
  );
});
