import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SchedulesService,
} = require('../dist/src/modules/schedules/schedules.service.js');

function serviceWith(prisma) {
  return new SchedulesService(prisma);
}

test('O9 rejects inverted slot time ranges before persistence', async () => {
  let created = false;
  const service = serviceWith({
    gym: { findFirst: async () => ({ id: 'gym-a' }) },
    scheduleSlot: {
      create: async () => {
        created = true;
        return {};
      },
    },
  });

  await assert.rejects(
    () =>
      service.createSlot(
        {
          weekday: 1,
          startTime: '18:00',
          endTime: '17:00',
          capacity: 10,
        },
        'gym-a',
      ),
    /Horario inicial deve ser anterior/,
  );
  assert.equal(created, false);
});

test('O9 rejects booking when date weekday diverges from the canonical slot', async () => {
  let created = false;
  const tx = {
    student: { findFirst: async () => ({ id: 'student-a' }) },
    scheduleSlot: {
      findFirst: async () => ({
        id: 'slot-a',
        gymId: 'gym-a',
        weekday: 1,
        capacity: 10,
      }),
    },
    studentSchedule: {
      findFirst: async () => null,
      count: async () => 0,
      create: async () => {
        created = true;
        return {};
      },
    },
  };
  const service = serviceWith({
    $transaction: async (handler) => handler(tx),
  });

  await assert.rejects(
    () =>
      service.book(
        {
          studentId: 'student-a',
          slotId: 'slot-a',
          date: '2026-09-29',
        },
        'gym-a',
      ),
    /Data escolhida nao corresponde ao dia da semana do horario/,
  );
  assert.equal(created, false);
});

test('O9 accepts booking on the slot weekday and keeps serializable capacity flow', async () => {
  let isolationLevel = null;
  let created = null;
  const tx = {
    student: { findFirst: async () => ({ id: 'student-a' }) },
    scheduleSlot: {
      findFirst: async () => ({
        id: 'slot-a',
        gymId: 'gym-a',
        weekday: 1,
        capacity: 10,
      }),
    },
    studentSchedule: {
      findFirst: async () => null,
      count: async () => 3,
      create: async (args) => {
        created = args;
        return { id: 'booking-a' };
      },
    },
  };
  const service = serviceWith({
    $transaction: async (handler, options) => {
      isolationLevel = options?.isolationLevel;
      return handler(tx);
    },
  });

  const result = await service.book(
    {
      studentId: 'student-a',
      slotId: 'slot-a',
      date: '2026-09-28',
    },
    'gym-a',
  );

  assert.equal(result.id, 'booking-a');
  assert.equal(isolationLevel, 'Serializable');
  assert.equal(created.data.studentId, 'student-a');
  assert.equal(created.data.slotId, 'slot-a');
});
