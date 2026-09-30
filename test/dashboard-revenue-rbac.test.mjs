import test from 'node:test';
import assert from 'node:assert/strict';

const { DashboardController } = await import('../dist/src/modules/dashboard/dashboard.controller.js');
const { DashboardService } = await import('../dist/src/modules/dashboard/dashboard.service.js');

test('dashboard controller excludes financial data for staff and includes it for owner', async () => {
  const calls = [];
  const service = {
    getSummary: async (gymId, options) => {
      calls.push({ gymId, options });
      return { gymId, options };
    },
  };
  const controller = new DashboardController(service);

  await controller.getSummary({ gymId: 'gym-reception', roles: ['RECEPTION'] });
  await controller.getSummary({ activeGymId: 'gym-owner', gymId: 'old-gym', roles: ['OWNER'] });

  assert.deepEqual(calls[0], {
    gymId: 'gym-reception',
    options: { includeFinancial: false },
  });
  assert.deepEqual(calls[1], {
    gymId: 'gym-owner',
    options: { includeFinancial: true },
  });
});

test('dashboard service does not query or return financial data when includeFinancial is false', async () => {
  let aggregateCalls = 0;
  const prisma = {
    student: { count: async () => 0 },
    equipment: { count: async () => 0 },
    financialTransaction: {
      aggregate: async () => {
        aggregateCalls += 1;
        return { _sum: { amount: 12345 } };
      },
    },
    charge: { count: async () => 0 },
    workout: { count: async () => 0 },
  };
  const service = new DashboardService(prisma);
  const summary = await service.getSummary('gym-1', { includeFinancial: false });

  assert.equal(aggregateCalls, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'revenue'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'charges'), false);
  assert.equal(summary.students.total, 0);
});
