import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrivacyGovernanceService } = require('../dist/src/modules/privacy/privacy-governance.service.js');

function makeHarness(student = {
  id: 'student-self',
  gymId: 'gym-a',
  consentHealth: false,
  consentComm: true,
  consentBiometry: false,
}) {
  const calls = {
    find: [],
    update: [],
    audits: [],
  };

  const prisma = {
    student: {
      findFirst: async (args) => {
        calls.find.push(args);
        return student;
      },
      update: async (args) => {
        calls.update.push(args);
        return {
          id: student.id,
          consentHealth: args.data.consentHealth,
          consentComm: args.data.consentComm,
          consentBiometry: args.data.consentBiometry,
        };
      },
    },
    $transaction: async (operation) => operation(prisma),
  };

  const audit = {
    record: async (args) => {
      calls.audits.push(args);
      return { id: 'audit-a' };
    },
  };

  return { service: new PrivacyGovernanceService(prisma, audit), calls };
}

test('O18 reads consents by authenticated user id only', async () => {
  const { service, calls } = makeHarness();

  const result = await service.getMyConsents('user-self');

  assert.deepEqual(calls.find[0].where, { userId: 'user-self' });
  assert.equal(result.available, true);
  assert.equal(result.studentId, 'student-self');
  assert.equal(result.consentComm, true);
});

test('O18 returns non-applicable state for authenticated users without Student profile', async () => {
  const { service } = makeHarness(null);

  const result = await service.getMyConsents('owner-user');

  assert.deepEqual(result, {
    available: false,
    studentId: null,
    consentHealth: null,
    consentComm: null,
    consentBiometry: null,
  });
});

test('O18 updates only the authenticated users own Student row and audits before/after', async () => {
  const { service, calls } = makeHarness();

  const result = await service.updateMyConsents('user-self', {
    consentHealth: true,
  });

  assert.deepEqual(calls.find[0].where, { userId: 'user-self' });
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].where.id, 'student-self');
  assert.deepEqual(calls.update[0].data, {
    consentHealth: true,
    consentComm: true,
    consentBiometry: false,
  });
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].gymId, 'gym-a');
  assert.equal(calls.audits[0].userId, 'user-self');
  assert.equal(calls.audits[0].action, 'PRIVACY_SELF_CONSENTS_UPDATED');
  assert.equal(result.consentHealth, true);
});

test('O18 rejects an empty consent update before any database write', async () => {
  const { service, calls } = makeHarness();

  await assert.rejects(
    () => service.updateMyConsents('user-self', {}),
    /Informe ao menos um consentimento/,
  );

  assert.equal(calls.find.length, 0);
  assert.equal(calls.update.length, 0);
  assert.equal(calls.audits.length, 0);
});
