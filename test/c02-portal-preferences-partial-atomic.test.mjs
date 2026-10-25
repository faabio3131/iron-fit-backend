import test from 'node:test';
import assert from 'node:assert/strict';
const { PortalService } = await import('../dist/src/modules/portal/portal.service.js');

function setup({ wrongTenant = false, conflictOnce = false, failAudit = false } = {}) {
  let writes = 0, audits = 0, txCount = 0;
  const current = {
    id: 'pref-a',
    studentId: 'student-a',
    pushEnabled: true, inAppEnabled: true, emailEnabled: true,
    whatsappEnabled: true, trainingReminders: true,
    paymentReminders: true, marketing: false,
  };
  const tx = {
    student: { findFirst: async ({ where }) => {
      assert.deepEqual(where, { userId: 'user-a', gymId: 'gym-a' });
      return wrongTenant ? null : { id: 'student-a', gymId: 'gym-a', consentComm: true };
    } },
    communicationPreference: {
      findUnique: async ({ where }) => {
        assert.deepEqual(where, { studentId: 'student-a' });
        return { ...current };
      },
      upsert: async ({ where, update, create }) => {
        assert.deepEqual(where, { studentId: 'student-a' });
        assert.equal(create.studentId, 'student-a');
        writes++;
        for (const k of Object.keys(update)) assert.equal(typeof update[k], 'boolean');
        Object.assign(current, update);
        return { ...current };
      },
    },
  };
  const prisma = {
    $transaction: async (operation, options) => {
      txCount++;
      assert.equal(options.isolationLevel, 'Serializable');
      if (conflictOnce && txCount === 1) throw Object.assign(new Error('serialization'), { code: 'P2034' });
      const previous = { ...current };
      try { return await operation(tx); } catch (error) {
        Object.assign(current, previous);
        throw error;
      }
    },
  };
  const audit = { record: async (event, passedTx) => {
    assert.equal(passedTx, tx);
    assert.equal(event.action, 'STUDENT_COMMUNICATION_PREFERENCES_UPDATED');
    assert.equal(event.gymId, 'gym-a');
    audits++;
    if (failAudit) throw new Error('audit failure');
  } };
  return { service: new PortalService(prisma, audit),
    get: () => ({ ...current }), counters: () => ({ writes, audits, txCount }) };
}

test('C02 partial preference update preserves unrelated fields and returns persisted values', async () => {
  const x = setup();
  const result = await x.service.updateCommunicationPreferences(
    'user-a', { emailEnabled: false }, 'gym-a',
  );
  assert.equal(result.emailEnabled, false);
  assert.equal(result.whatsappEnabled, true);
  assert.equal(result.trainingReminders, true);
  assert.equal(x.get().whatsappEnabled, true);
  assert.equal(x.counters().audits, 1);
});

test('C02 distinct preference patches do not reverse an earlier preference update', async () => {
  const x = setup();
  await x.service.updateCommunicationPreferences('user-a', { marketing: true }, 'gym-a');
  await x.service.updateCommunicationPreferences('user-a', { pushEnabled: false }, 'gym-a');
  assert.equal(x.get().marketing, true);
  assert.equal(x.get().pushEnabled, false);
});

test('C02 rejects empty preference patch without writing or auditing', async () => {
  const x = setup();
  await assert.rejects(
    () => x.service.updateCommunicationPreferences('user-a', {}, 'gym-a'),
    error => error?.getStatus?.() === 400,
  );
  assert.equal(x.counters().txCount, 0);
});

test('C02 refuses preference write when student is not in active tenant', async () => {
  const x = setup({ wrongTenant: true });
  await assert.rejects(
    () => x.service.updateCommunicationPreferences('user-a', { marketing: true }, 'gym-a'),
    error => error?.getStatus?.() === 404,
  );
  assert.equal(x.counters().writes, 0);
});

test('C02 transaction retries serialization conflict without duplicating audit', async () => {
  const x = setup({ conflictOnce: true });
  const result = await x.service.updateCommunicationPreferences(
    'user-a', { whatsappEnabled: false }, 'gym-a',
  );
  assert.equal(result.whatsappEnabled, false);
  assert.deepEqual(x.counters(), { writes: 1, audits: 1, txCount: 2 });
});

test('C02 failed audit cannot commit preference changes', async () => {
  const x = setup({ failAudit: true });
  await assert.rejects(
    () => x.service.updateCommunicationPreferences('user-a', { whatsappEnabled: false }, 'gym-a'),
    /audit failure/,
  );
  assert.equal(x.get().whatsappEnabled, true);
});
