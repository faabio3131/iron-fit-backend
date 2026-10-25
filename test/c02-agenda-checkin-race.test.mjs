import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SchedulesService } = require('../dist/src/modules/schedules/schedules.service.js');

test('C02 concurrent check-ins can complete exactly once without overwriting original timestamp', async () => {
  let status = 'SCHEDULED';
  let checkedInAt = null;
  let reads = 0;
  let writes = 0;
  const prisma = {
    studentSchedule: {
      findFirst: async ({ where }) => {
        reads += 1;
        assert.deepEqual(where, { id: 'booking-1', student: { gymId: 'gym-a' }, slot: { gymId: 'gym-a' } });
        // The two requests both observed the same original state.
        return { id: 'booking-1', status: 'SCHEDULED', slot: {}, student: {} };
      },
      update: async ({ where, data }) => {
        assert.deepEqual(where, { id: 'booking-1', status: 'SCHEDULED' });
        writes += 1;
        if (status !== 'SCHEDULED') {
          const error = new Error('Record not found for conditional update');
          error.code = 'P2025';
          throw error;
        }
        status = data.status;
        checkedInAt = data.checkedInAt;
        return { id: 'booking-1', status, checkedInAt };
      },
    },
  };

  const service = new SchedulesService(prisma);
  const results = await Promise.allSettled([
    service.checkIn('booking-1', 'gym-a'),
    service.checkIn('booking-1', 'gym-a'),
  ]);
  const passed = results.filter((result) => result.status === 'fulfilled');
  const denied = results.filter((result) => result.status === 'rejected');
  assert.equal(reads, 2);
  assert.equal(writes, 2);
  assert.equal(passed.length, 1);
  assert.equal(passed[0].value.status, 'CHECKED_IN');
  assert.equal(denied.length, 1);
  assert.equal(denied[0].reason?.getStatus?.(), 400);
  assert.match(denied[0].reason.message, /Agendamento nao pode receber check-in/);
  assert.equal(checkedInAt, passed[0].value.checkedInAt);
});

test('C02 check-in for a booking from another academy never reaches the mutation', async () => {
  let writes = 0;
  const service = new SchedulesService({
    studentSchedule: {
      findFirst: async ({ where }) => {
        assert.equal(where.student.gymId, 'gym-a');
        assert.equal(where.slot.gymId, 'gym-a');
        return null;
      },
      update: async () => { writes += 1; },
    },
  });
  await assert.rejects(
    () => service.checkIn('gym-b-booking', 'gym-a'),
    (error) => error?.getStatus?.() === 404,
  );
  assert.equal(writes, 0);
});
