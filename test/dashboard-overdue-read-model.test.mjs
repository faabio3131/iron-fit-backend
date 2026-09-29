import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { DashboardService } = require('../dist/src/modules/dashboard/dashboard.service.js');
const { FinancialService } = require('../dist/src/modules/financial/financial.service.js');

function fixture() {
  const calls = [];
  const prisma = {
    charge: {
      findMany: async (args) => {
        calls.push(args);
        return [];
      },
    },
  };
  return { calls, prisma };
}

function assertSafeTenantChargeRead(args, gymId) {
  assert.equal(args.where.gymId, gymId);
  assert.equal(args.include, undefined);
  assert.equal(args.select.gymId, true);
  assert.equal(args.select.student.select.gymId, true);
  assert.deepEqual(args.select.student.select.user.select, {
    id: true,
    name: true,
    email: true,
    phone: true,
  });
  assert.equal('passwordHash' in args.select.student.select.user.select, false);
  assert.equal('mfaSecret' in args.select.student.select.user.select, false);

  for (const driftedGatewayColumn of [
    'gatewayProviderCode',
    'gatewayConnectionId',
    'gatewayRequestId',
    'gatewayCheckoutExpiresAt',
  ]) {
    assert.equal(driftedGatewayColumn in args.select, false);
  }
}

test('dashboard overdue read is tenant scoped and selects only its public contract', async () => {
  const { calls, prisma } = fixture();
  const service = new DashboardService(prisma);

  assert.deepEqual(await service.getOverdueCharges('gym-a'), []);
  assert.equal(calls.length, 1);
  assertSafeTenantChargeRead(calls[0], 'gym-a');
  assert.equal(calls[0].where.status, 'PENDING');
  assert.ok(calls[0].where.dueDate.lt instanceof Date);
  assert.deepEqual(calls[0].orderBy, { dueDate: 'asc' });
  assert.equal(calls[0].take, 20);
});

test('financial charge listing reuses the safe tenant read model', async () => {
  const { calls, prisma } = fixture();
  const service = new FinancialService(prisma);

  assert.deepEqual(await service.findAllCharges('gym-b'), []);
  assert.equal(calls.length, 1);
  assertSafeTenantChargeRead(calls[0], 'gym-b');
  assert.deepEqual(calls[0].orderBy, { dueDate: 'desc' });
});
