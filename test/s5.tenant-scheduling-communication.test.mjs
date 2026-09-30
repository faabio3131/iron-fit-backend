import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveTenantOperationGymId } = require('../dist/src/common/security/tenant-operation-scope.js');
const { SchedulesService } = require('../dist/src/modules/schedules/schedules.service.js');
const { CommunicationService } = require('../dist/src/modules/communication/communication.service.js');

test('tenant actor cannot override active Gym A with Gym B', () => {
  assert.throws(
    () => resolveTenantOperationGymId({
      activeGymId: 'gym-a',
      requestedGymId: 'gym-b',
      isSuperAdmin: false,
    }),
    /Academia nao encontrada/,
  );
});

test('global SUPER_ADMIN must choose an explicit tenant for domain operations', () => {
  assert.throws(
    () => resolveTenantOperationGymId({
      activeGymId: null,
      requestedGymId: null,
      isSuperAdmin: true,
    }),
    /Academia obrigatoria/,
  );
  assert.equal(
    resolveTenantOperationGymId({
      activeGymId: null,
      requestedGymId: 'gym-b',
      isSuperAdmin: true,
    }),
    'gym-b',
  );
});

test('S5 removes dto.gymId fallback from equipment, schedules and communication services', async () => {
  for (const path of [
    'src/modules/equipments/equipments.service.ts',
    'src/modules/schedules/schedules.service.ts',
    'src/modules/communication/communication.service.ts',
  ]) {
    const source = await readFile(path, 'utf8');
    assert.equal(source.includes('dto.gymId || userGymId'), false, path);
  }
});

test('booking retries serialization conflicts and runs capacity decision at Serializable isolation', async () => {
  let transactionCalls = 0;
  const isolationLevels = [];
  const tx = {
    student: {
      findFirst: async ({ where }) => ({ id: where.id, gymId: where.gymId }),
    },
    scheduleSlot: {
      findFirst: async ({ where }) => ({ id: where.id, gymId: where.gymId, weekday: 5, capacity: 1, active: true }),
    },
    studentSchedule: {
      findFirst: async () => null,
      count: async () => 0,
      create: async ({ data }) => ({ id: 'booking-1', ...data }),
    },
  };
  const prisma = {
    $transaction: async (callback, options) => {
      transactionCalls += 1;
      isolationLevels.push(options?.isolationLevel);
      if (transactionCalls === 1) {
        const error = new Error('serialization conflict');
        error.code = 'P2034';
        throw error;
      }
      return callback(tx);
    },
  };

  const service = new SchedulesService(prisma);
  const result = await service.book({
    studentId: 'student-a',
    slotId: 'slot-a',
    date: '2026-09-04T10:00:00.000Z',
  }, 'gym-a');

  assert.equal(result.id, 'booking-1');
  assert.equal(transactionCalls, 2);
  assert.deepEqual(isolationLevels, ['Serializable', 'Serializable']);
});

test('booking validates both student and slot inside the same tenant transaction', async () => {
  const calls = { student: null, slot: null };
  const tx = {
    student: {
      findFirst: async (args) => {
        calls.student = args;
        return { id: 'student-a', gymId: 'gym-a' };
      },
    },
    scheduleSlot: {
      findFirst: async (args) => {
        calls.slot = args;
        return { id: 'slot-a', gymId: 'gym-a', weekday: 5, capacity: 2, active: true };
      },
    },
    studentSchedule: {
      findFirst: async () => null,
      count: async () => 0,
      create: async () => ({ id: 'booking-a' }),
    },
  };
  const prisma = {
    $transaction: async (callback) => callback(tx),
  };

  const service = new SchedulesService(prisma);
  await service.book({ studentId: 'student-a', slotId: 'slot-a', date: '2026-09-04' }, 'gym-a');

  assert.deepEqual(calls.student.where, { id: 'student-a', gymId: 'gym-a' });
  assert.deepEqual(calls.slot.where, { id: 'slot-a', gymId: 'gym-a', active: true });
});

test('communication message cannot use a template from another gym', async () => {
  let messageCreated = false;
  const prisma = {
    student: {
      findFirst: async () => ({ id: 'student-a', gymId: 'gym-a' }),
    },
    communicationTemplate: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { id: 'template-b', gymId: 'gym-a', active: true });
        return null;
      },
    },
    communicationMessage: {
      create: async () => {
        messageCreated = true;
      },
    },
  };

  const service = new CommunicationService(prisma);
  await assert.rejects(
    () => service.sendMessage({
      studentId: 'student-a',
      templateId: 'template-b',
      channel: 'WHATSAPP',
      body: 'Teste',
    }, 'gym-a'),
    /Template nao encontrado/,
  );
  assert.equal(messageCreated, false);
});
