import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Prisma } = require('@prisma/client');
const { StudentsService } = require('../dist/src/modules/students/students.service.js');

function makeService(prisma, audits) {
  return new StudentsService(prisma, {
    record: async (event, tx) => {
      assert.ok(tx);
      audits.push(event);
    },
  }, {});
}

test('C02 consent write changes only the supplied field, with tenant-scoped atomic audit', async () => {
  const audits = [];
  let record = {
    id: 'student-1', gymId: 'gym-a', consentHealth: false,
    consentComm: false, consentBiometry: false,
  };
  const tx = {
    student: {
      findFirst: async ({ where, select }) => {
        assert.deepEqual(where, { id: 'student-1', gymId: 'gym-a' });
        assert.ok(select.consentBiometry);
        const previous = { ...record };
        // An independent preference changes between reading and writing.
        record = { ...record, consentComm: true };
        return previous;
      },
      update: async ({ where, data }) => {
        assert.deepEqual(where, { id: 'student-1', gymId: 'gym-a' });
        assert.deepEqual(data, { consentHealth: true });
        record = { ...record, ...data };
        return { ...record };
      },
    },
  };
  const prisma = {
    $transaction: async (callback, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return callback(tx);
    },
  };
  const result = await makeService(prisma, audits)
    .updateConsents('student-1', { consentHealth: true }, 'gym-a', 'owner-1');
  assert.equal(result.consentHealth, true);
  assert.equal(result.consentComm, true);
  assert.equal(result.consentBiometry, false);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].gymId, 'gym-a');
  assert.equal(audits[0].userId, 'owner-1');
  assert.equal(audits[0].action, 'STUDENT_CONSENTS_UPDATED');
});

test('C02 consent mutation denies a different academy and cannot persist/audit', async () => {
  let updates = 0;
  const audits = [];
  const tx = {
    student: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { id: 'student-b', gymId: 'gym-a' });
        return null;
      },
      update: async () => { updates++; },
    },
  };
  const service = makeService({ $transaction: async fn => fn(tx) }, audits);
  await assert.rejects(
    () => service.updateConsents('student-b', { consentHealth: true }, 'gym-a'),
    err => err?.getStatus?.() === 404,
  );
  assert.equal(updates, 0);
  assert.equal(audits.length, 0);
});

test('C02 consent rejects absent patch and absent tenant before database access', async () => {
  let accessed = false;
  const service = makeService({
    $transaction: async () => { accessed = true; },
  }, []);
  await assert.rejects(
    () => service.updateConsents('student-1', {}, 'gym-a'),
    err => err?.getStatus?.() === 400,
  );
  await assert.rejects(
    () => service.updateConsents('student-1', { consentHealth: false }),
    err => err?.getStatus?.() === 400,
  );
  assert.equal(accessed, false);
});

test('C02 stale tenant ownership at conditional write returns not found without audit', async () => {
  const audits = [];
  const tx = { student: {
    findFirst: async () => ({
      id: 'student-1', consentHealth: false,
      consentComm: false, consentBiometry: false,
    }),
    update: async ({ where }) => {
      assert.deepEqual(where, { id: 'student-1', gymId: 'gym-a' });
      throw new Prisma.PrismaClientKnownRequestError('not found', {
        code: 'P2025', clientVersion: '6.19.3',
      });
    },
  } };
  const service = makeService({ $transaction: async cb => cb(tx) }, audits);
  await assert.rejects(
    () => service.updateConsents('student-1', { consentHealth: true }, 'gym-a'),
    err => err?.getStatus?.() === 404,
  );
  assert.equal(audits.length, 0);
});

test('C02 serializable contention retries without duplicate audits', async () => {
  const audits = [];
  let attempts = 0;
  const tx = { student: {
    findFirst: async () => ({
      id: 'student-1', consentHealth: false,
      consentComm: false, consentBiometry: false,
    }),
    update: async ({ data }) => ({ id: 'student-1',
      consentHealth: data.consentHealth, consentComm: false, consentBiometry: false }),
  } };
  const service = makeService({
    $transaction: async (cb, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      attempts++;
      if (attempts === 1) {
        throw new Prisma.PrismaClientKnownRequestError('serialization conflict', {
          code: 'P2034', clientVersion: '6.19.3',
        });
      }
      return cb(tx);
    },
  }, audits);
  const result = await service.updateConsents('student-1', {
    consentHealth: true,
  }, 'gym-a');
  assert.equal(result.consentHealth, true);
  assert.equal(attempts, 2);
  assert.equal(audits.length, 1);
});
