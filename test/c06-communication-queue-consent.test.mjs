import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CommunicationService } = require('../dist/src/modules/communication/communication.service.js');

const dto = { studentId: 'student-a', channel: 'WHATSAPP', body: 'Lembrete do treino' };

function fixture(student) {
  const events = { studentQuery: null, queued: [] };
  const prisma = {
    student: {
      findFirst: async (query) => { events.studentQuery = query; return student; },
    },
    communicationMessage: {
      create: async (query) => {
        events.queued.push(query);
        return { id: 'queued-a', ...query.data };
      },
    },
    communicationTemplate: { findFirst: async () => ({ id: 'template-a' }) },
  };
  return { events, service: new CommunicationService(prisma) };
}

test('C06 intake blocks queue for inactive/suspended students even when consent is true', async () => {
  for (const status of ['INACTIVE', 'SUSPENDED']) {
    const { events, service } = fixture({ id: 'student-a', gymId: 'gym-a', status, consentComm: true });
    await assert.rejects(service.sendMessage(dto, 'gym-a'), /sem matricula ativa ou consentimento/);
    assert.deepEqual(events.studentQuery, { where: { id: 'student-a', gymId: 'gym-a' } });
    assert.equal(events.queued.length, 0);
  }
});

test('C06 intake blocks missing or revoked communication consent even for ACTIVE students', async () => {
  for (const consentComm of [false, null, undefined]) {
    const { events, service } = fixture({ id: 'student-a', gymId: 'gym-a', status: 'ACTIVE', consentComm });
    await assert.rejects(service.sendMessage(dto, 'gym-a'), /sem matricula ativa ou consentimento/);
    assert.equal(events.queued.length, 0);
  }
});

test('C06 intake enqueues canonical scoped message for active consenting student only', async () => {
  const { events, service } = fixture({
    id: 'student-a', gymId: 'gym-a', status: 'ACTIVE', consentComm: true,
  });
  const result = await service.sendMessage(dto, 'gym-a');
  assert.equal(result.status, 'QUEUED');
  assert.equal(events.queued.length, 1);
  assert.deepEqual(events.studentQuery, { where: { id: 'student-a', gymId: 'gym-a' } });
  assert.equal(events.queued[0].data.gymId, 'gym-a');
  assert.equal(events.queued[0].data.studentId, 'student-a');
  assert.equal(events.queued[0].data.body, 'Lembrete do treino');
  assert.equal(typeof events.queued[0].data.dispatchKey, 'string');
});

test('C06 student not found inside tenant never queues; cross-tenant scope is not browser controlled', async () => {
  const { events, service } = fixture(null);
  await assert.rejects(service.sendMessage(dto, 'gym-a'), /Aluno nao encontrado/);
  assert.equal(events.queued.length, 0);
  assert.deepEqual(events.studentQuery, { where: { id: 'student-a', gymId: 'gym-a' } });
});
