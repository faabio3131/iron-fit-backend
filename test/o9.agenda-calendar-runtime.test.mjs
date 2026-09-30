import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SchedulesService,
} = require('../dist/src/modules/schedules/schedules.service.js');

function buildService() {
  const calls = [];
  const prisma = {
    studentSchedule: {
      findMany: async (args) => {
        calls.push(args);
        return [];
      },
    },
  };
  return { service: new SchedulesService(prisma), calls };
}

test('O9 calendar query scopes both student and slot to the active tenant', async () => {
  const { service, calls } = buildService();

  await service.findAllSchedules('gym-a', {
    from: '2026-09-28',
    to: '2026-10-04',
    status: 'SCHEDULED',
    studentId: 'student-a',
  });

  assert.equal(calls.length, 1);
  const query = calls[0];
  assert.deepEqual(query.where.student, { gymId: 'gym-a' });
  assert.deepEqual(query.where.slot, { gymId: 'gym-a' });
  assert.equal(query.where.studentId, 'student-a');
  assert.equal(query.where.status, 'SCHEDULED');
  assert.equal(query.where.date.gte.toISOString(), '2026-09-28T00:00:00.000Z');
  assert.equal(query.where.date.lte.toISOString(), '2026-10-04T00:00:00.000Z');
  assert.equal(query.take, 500);
});

test('O9 calendar query fails closed for invalid status and dates', async () => {
  const { service, calls } = buildService();

  await assert.rejects(
    () => service.findAllSchedules('gym-a', { status: 'FORGED' }),
    /Status de agendamento invalido/,
  );
  await assert.rejects(
    () => service.findAllSchedules('gym-a', { from: 'not-a-date' }),
    /Data inicial invalida/,
  );
  await assert.rejects(
    () =>
      service.findAllSchedules('gym-a', {
        from: '2026-10-05',
        to: '2026-10-04',
      }),
    /Data inicial nao pode ser posterior/,
  );
  assert.equal(calls.length, 0);
});
