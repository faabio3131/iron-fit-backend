import test from 'node:test';
import assert from 'node:assert/strict';

const { DashboardController } = await import('../dist/src/modules/dashboard/dashboard.controller.js');
const { DashboardService } = await import('../dist/src/modules/dashboard/dashboard.service.js');

test('dashboard summary exposes financial data only for owner with active step-up', async () => {
  const calls = [];
  const service = {
    getSummary: async (gymId, options) => {
      calls.push({ gymId, options });
      return { gymId, options };
    },
  };
  const stepUp = {
    status: async (_userId, sessionId) => ({
      active: sessionId === 'owner-stepup',
      expiresAt: null,
    }),
  };
  const controller = new DashboardController(service, stepUp);

  await controller.getSummary({ id: 'reception-1', sessionId: 'reception', gymId: 'gym-reception', roles: ['RECEPTION'] });
  await controller.getSummary({ id: 'owner-1', sessionId: 'owner-no-stepup', activeGymId: 'gym-owner', roles: ['OWNER'] });
  await controller.getSummary({ id: 'owner-1', sessionId: 'owner-stepup', activeGymId: 'gym-owner', roles: ['OWNER'] });

  assert.deepEqual(calls[0], { gymId: 'gym-reception', options: { includeFinancial: false } });
  assert.deepEqual(calls[1], { gymId: 'gym-owner', options: { includeFinancial: false } });
  assert.deepEqual(calls[2], { gymId: 'gym-owner', options: { includeFinancial: true } });
});

test('dashboard service does not query or return financial data when includeFinancial is false', async () => {
  let aggregateCalls = 0;
  let chargeCountCalls = 0;
  const prisma = {
    student: { count: async () => 0 },
    equipment: { count: async () => 0 },
    financialTransaction: {
      aggregate: async () => {
        aggregateCalls += 1;
        return { _sum: { amount: 12345 } };
      },
    },
    charge: { count: async () => { chargeCountCalls += 1; return 0; } },
    workout: { count: async () => 0 },
  };
  const service = new DashboardService(prisma);
  const summary = await service.getSummary('gym-1', { includeFinancial: false });

  assert.equal(aggregateCalls, 0);
  assert.equal(chargeCountCalls, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'revenue'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'charges'), false);
  assert.equal(summary.students.total, 0);
});
