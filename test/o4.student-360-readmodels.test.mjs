import test from 'node:test';
import assert from 'node:assert/strict';

const { SchedulesService } = await import('../dist/src/modules/schedules/schedules.service.js');
const { AccessService } = await import('../dist/src/modules/access/access.service.js');
const { FinancialService } = await import('../dist/src/modules/financial/financial.service.js');

test('O4 student schedule history is tenant-scoped before reading bookings', async () => {
  let scheduleWhere = null;
  const prisma = {
    student: {
      findFirst: async ({ where }) => where.id === 'student-1' && where.gymId === 'gym-1' ? { id: 'student-1' } : null,
    },
    studentSchedule: {
      findMany: async ({ where }) => {
        scheduleWhere = where;
        return [];
      },
    },
  };
  const service = new SchedulesService(prisma);
  await service.findByStudent('student-1', 'gym-1');
  assert.deepEqual(scheduleWhere, {
    studentId: 'student-1',
    student: { gymId: 'gym-1' },
    slot: { gymId: 'gym-1' },
  });
  await assert.rejects(() => service.findByStudent('student-1', 'gym-2'), /Aluno nao encontrado/);
});

test('O4 access history filter cannot remove tenant scope', async () => {
  let where = null;
  const prisma = {
    accessEvent: {
      findMany: async (args) => {
        where = args.where;
        return [];
      },
    },
  };
  const service = new AccessService(prisma);
  await service.findRecentEvents('gym-1', { studentId: 'student-1' });
  assert.deepEqual(where, { gymId: 'gym-1', studentId: 'student-1' });
});

test('O4 financial read models remain gym-scoped when filtered by student', async () => {
  const observed = [];
  const prisma = {
    subscription: {
      findMany: async (args) => {
        observed.push(args.where);
        return [];
      },
    },
    charge: {
      findMany: async (args) => {
        observed.push(args.where);
        return [];
      },
    },
  };
  const service = new FinancialService(prisma);
  await service.findSubscriptions('gym-1', 'student-1');
  await service.findAllCharges('gym-1', 'student-1');
  assert.deepEqual(observed, [
    { gymId: 'gym-1', studentId: 'student-1' },
    { gymId: 'gym-1', studentId: 'student-1' },
  ]);
});
