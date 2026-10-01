import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { PortalService } = require('../dist/src/modules/portal/portal.service.js');

function baseStudent() {
  return {
    id: 'student-a',
    userId: 'user-a',
    gymId: 'gym-a',
    consentComm: false,
    gym: { id: 'gym-a', name: 'Gym A', slug: 'gym-a', logoUrl: null },
    user: { id: 'user-a', name: 'Aluno A', email: 'a@example.com', phone: null },
  };
}

test('O19B preferences route remains STUDENT-only and has no tenant selector', async () => {
  const source = await readFile('src/modules/portal/portal.controller.ts', 'utf8');

  assert.match(source, /@Roles\('STUDENT'\)/);
  assert.match(source, /@Get\('preferences'\)/);
  assert.match(source, /@Patch\('preferences'\)/);
  assert.equal(source.includes('requestedGymId'), false);
  assert.equal(source.includes('gymId: dto'), false);
});

test('O19B returns fail-closed communication defaults without inventing consent', async () => {
  const prisma = {
    student: { findFirst: async () => baseStudent() },
    communicationPreference: { findUnique: async () => null },
  };
  const service = new PortalService(prisma, { record: async () => undefined });

  const result = await service.getCommunicationPreferences('user-a', 'gym-a');

  assert.equal(result.studentId, 'student-a');
  assert.equal(result.consentComm, false);
  assert.equal(result.configured, false);
  assert.equal(result.whatsappEnabled, false);
  assert.equal(result.emailEnabled, false);
  assert.equal(result.marketing, false);
  assert.equal(result.trainingReminders, true);
  assert.equal(result.paymentReminders, true);
});

test('O19B preference update is canonical, whitelisted and audited', async () => {
  const writes = [];
  const audits = [];
  const prisma = {
    student: { findFirst: async () => ({ ...baseStudent(), consentComm: true }) },
    communicationPreference: {
      findUnique: async () => null,
      upsert: async (args) => {
        writes.push(args);
        return { id: 'pref-a', studentId: 'student-a', ...args.create };
      },
    },
  };
  const service = new PortalService(prisma, {
    record: async (entry) => { audits.push(entry); },
  });

  const result = await service.updateCommunicationPreferences(
    'user-a',
    {
      whatsappEnabled: true,
      trainingReminders: false,
    },
    'gym-a',
  );

  assert.equal(writes.length, 1);
  assert.equal(writes[0].where.studentId, 'student-a');
  assert.equal(writes[0].create.studentId, 'student-a');
  assert.equal(writes[0].create.whatsappEnabled, true);
  assert.equal(writes[0].create.trainingReminders, false);
  assert.equal(result.consentComm, true);
  assert.equal(result.whatsappEnabled, true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].gymId, 'gym-a');
  assert.equal(audits[0].userId, 'user-a');
  assert.equal(audits[0].action, 'STUDENT_COMMUNICATION_PREFERENCES_UPDATED');
});
