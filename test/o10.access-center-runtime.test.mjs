import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AccessService } = require('../dist/src/modules/access/access.service.js');

function makePrisma() {
  const calls = {
    events: [],
    credentials: [],
    devices: [],
    credentialFind: [],
    credentialUpdate: [],
    audits: [],
  };
  const prisma = {
    accessEvent: {
      findMany: async (args) => {
        calls.events.push(args);
        return [];
      },
    },
    accessCredential: {
      findMany: async (args) => {
        calls.credentials.push(args);
        return [{
          id: 'credential-a',
          studentId: 'student-a',
          type: 'QR_CODE',
          active: true,
          expiresAt: null,
          student: {
            id: 'student-a',
            status: 'ACTIVE',
            user: { name: 'Ana', email: 'ana@example.com' },
          },
        }];
      },
      findFirst: async (args) => {
        calls.credentialFind.push(args);
        return {
          id: 'credential-a',
          studentId: 'student-a',
          type: 'QR_CODE',
          active: true,
          expiresAt: null,
        };
      },
      update: async (args) => {
        calls.credentialUpdate.push(args);
        return {
          id: 'credential-a',
          studentId: 'student-a',
          type: 'QR_CODE',
          active: false,
          expiresAt: null,
        };
      },
    },
    accessDevice: {
      findMany: async (args) => {
        calls.devices.push(args);
        return [];
      },
    },
    auditLog: {
      create: async (args) => {
        calls.audits.push(args);
        return { id: 'audit-a' };
      },
    },
  };
  return { prisma, calls };
}

test('O10 event timeline applies tenant and operational filters with enriched safe relations', async () => {
  const { prisma, calls } = makePrisma();
  const service = new AccessService(prisma);

  await service.findRecentEvents('gym-a', {
    studentId: 'student-a',
    deviceId: 'device-a',
    allowed: 'false',
    from: '2026-09-01',
    to: '2026-09-30T23:59:59.999Z',
  });

  assert.equal(calls.events.length, 1);
  const query = calls.events[0];
  assert.equal(query.where.gymId, 'gym-a');
  assert.equal(query.where.studentId, 'student-a');
  assert.equal(query.where.deviceId, 'device-a');
  assert.equal(query.where.allowed, false);
  assert.equal(query.select.student.user.select.name, true);
  assert.equal(query.select.device.name, true);
});

test('O10 credentials are tenant-scoped and never select secret hashes', async () => {
  const { prisma, calls } = makePrisma();
  const service = new AccessService(prisma);

  const result = await service.findCredentials('gym-a', {
    studentId: 'student-a',
    active: 'true',
  });

  const query = calls.credentials[0];
  assert.deepEqual(query.where.student, { gymId: 'gym-a' });
  assert.equal(query.where.studentId, 'student-a');
  assert.equal(query.where.active, true);
  assert.equal(query.select.tokenHash, undefined);
  assert.equal(query.select.biometricHash, undefined);
  assert.equal(result[0].status, 'ACTIVE');
});

test('O10 revokes only a credential belonging to the active tenant and audits the action', async () => {
  const { prisma, calls } = makePrisma();
  const service = new AccessService(prisma);

  const result = await service.revokeCredential(
    'credential-a',
    'gym-a',
    'owner-a',
  );

  assert.deepEqual(calls.credentialFind[0].where, {
    id: 'credential-a',
    student: { gymId: 'gym-a' },
  });
  assert.equal(calls.credentialUpdate[0].data.active, false);
  assert.equal(result.status, 'INACTIVE');
  assert.equal(calls.audits.length, 1);
});

test('O10 devices are tenant-scoped and omit device token hashes', async () => {
  const { prisma, calls } = makePrisma();
  const service = new AccessService(prisma);

  await service.findDevices('gym-a', { active: 'true' });

  const query = calls.devices[0];
  assert.equal(query.where.gymId, 'gym-a');
  assert.equal(query.where.active, true);
  assert.equal(query.select.deviceTokenHash, undefined);
  assert.equal(query.select.tokenRotatedAt, true);
});

test('O10 rejects malformed boolean filters before database reads', async () => {
  const { prisma, calls } = makePrisma();
  const service = new AccessService(prisma);

  await assert.rejects(
    () => service.findCredentials('gym-a', { active: 'yes' }),
    /active deve ser true ou false/,
  );
  await assert.rejects(
    () => service.findRecentEvents('gym-a', { allowed: 'maybe' }),
    /allowed deve ser true ou false/,
  );
  assert.equal(calls.credentials.length, 0);
  assert.equal(calls.events.length, 0);
});
