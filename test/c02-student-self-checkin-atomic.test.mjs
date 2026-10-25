import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PortalService } = require('../dist/src/modules/portal/portal.service.js');

function fixture({ studentStatus = 'ACTIVE', failCode = null, denyBooking = false, auditFails = false } = {}) {
  const calls = { lookups: [], updates: [], audits: 0 };
  let status = 'SCHEDULED';
  let checkedInAt = null;
  const student = {
    id: 'student-a', gymId: 'gym-a', userId: 'user-a', status: studentStatus,
  };
  const tx = {
    studentSchedule: {
      findFirst: async ({ where }) => {
        calls.lookups.push(where);
        assert.equal(where.studentId, student.id);
        assert.deepEqual(where.student, { gymId: 'gym-a', userId: 'user-a', status: 'ACTIVE' });
        assert.deepEqual(where.slot, { gymId: 'gym-a' });
        return denyBooking ? null : { id: 'booking-a', slot: { gymId: 'gym-a' } };
      },
      update: async ({ where, data }) => {
        calls.updates.push(where);
        assert.deepEqual(where, {
          id: 'booking-a', studentId: 'student-a', status: 'SCHEDULED',
          student: { gymId: 'gym-a', userId: 'user-a', status: 'ACTIVE' },
          slot: { gymId: 'gym-a' },
        });
        if (failCode || status !== 'SCHEDULED') {
          throw Object.assign(new Error('lost race'), { code: failCode ?? 'P2025' });
        }
        status = data.status;
        checkedInAt = data.checkedInAt;
        return { id: 'booking-a', status, checkedInAt, slot: { gymId: 'gym-a' } };
      },
    },
  };
  const prisma = {
    student: { findFirst: async ({ where }) => {
      assert.deepEqual(where, { userId: 'user-a', gymId: 'gym-a' });
      return student;
    } },
    $transaction: async (fn, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      const before = { status, checkedInAt };
      try { return await fn(tx); } catch (error) {
        status = before.status;
        checkedInAt = before.checkedInAt;
        throw error;
      }
    },
  };
  const audit = { record: async (entry, transaction) => {
    assert.equal(transaction, tx);
    assert.equal(entry.gymId, 'gym-a');
    assert.equal(entry.userId, 'user-a');
    assert.equal(entry.action, 'STUDENT_SELF_CHECK_IN');
    calls.audits++;
    if (auditFails) throw new Error('audit unavailable');
  } };
  return { service: new PortalService(prisma, audit), calls, state: () => ({ status, checkedInAt }) };
}

test('C02 mobile self check-in is tenant-scoped, guarded by active enrolment and audited', async () => {
  const x = fixture();
  const result = await x.service.checkIn('user-a', 'gym-a');
  assert.equal(result.status, 'CHECKED_IN');
  assert.equal(x.calls.updates.length, 1);
  assert.equal(x.calls.audits, 1);
  assert.equal(x.calls.lookups[0].status, 'SCHEDULED');
});

test('C02 concurrent student check-ins only allow a single successful mutation', async () => {
  const x = fixture();
  const results = await Promise.allSettled([
    x.service.checkIn('user-a', 'gym-a'), x.service.checkIn('user-a', 'gym-a'),
  ]);
  const success = results.filter(x => x.status === 'fulfilled');
  const denied = results.filter(x => x.status === 'rejected');
  assert.equal(success.length, 1);
  assert.equal(denied.length, 1);
  assert.equal(denied[0].reason?.getStatus?.(), 400);
  assert.equal(x.calls.audits, 1);
});

test('C02 suspended student cannot access self check-in even with a booking', async () => {
  const x = fixture({ studentStatus: 'SUSPENDED' });
  await assert.rejects(
    () => x.service.checkIn('user-a', 'gym-a'), /Matricula inativa nao permite check-in/,
  );
  assert.equal(x.calls.lookups.length, 0);
  assert.equal(x.calls.updates.length, 0);
});

test('C02 no booking for today does not mutate or audit a check-in', async () => {
  const x = fixture({ denyBooking: true });
  await assert.rejects(
    () => x.service.checkIn('user-a', 'gym-a'), /Nenhum agendamento para hoje/,
  );
  assert.equal(x.calls.updates.length, 0);
  assert.equal(x.calls.audits, 0);
});

test('C02 failed self check-in audit rolls back the status update', async () => {
  const x = fixture({ auditFails: true });
  await assert.rejects(
    () => x.service.checkIn('user-a', 'gym-a'), /audit unavailable/,
  );
  assert.equal(x.state().status, 'SCHEDULED');
});
