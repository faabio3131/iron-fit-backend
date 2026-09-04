import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AccessService } = require('../dist/src/modules/access/access.service.js');

const hash = (value) => createHash('sha256').update(value).digest('hex');

function basePrisma(overrides = {}) {
  let eventSeq = 0;
  let auditSeq = 0;
  return {
    accessDevice: {
      findUnique: async () => null,
      findFirst: async () => null,
      update: async () => ({}),
      ...overrides.accessDevice,
    },
    accessScanNonce: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({ id: 'nonce-1' }),
      ...overrides.accessScanNonce,
    },
    accessCredential: {
      findFirst: async () => null,
      create: async () => ({}),
      ...overrides.accessCredential,
    },
    accessEvent: {
      create: async (args) => ({ id: `event-${++eventSeq}`, ...args.data }),
      ...overrides.accessEvent,
    },
    auditLog: {
      create: async (args) => ({ id: `audit-${++auditSeq}`, ...args.data }),
      ...overrides.auditLog,
    },
    student: {
      findFirst: async () => null,
      ...overrides.student,
    },
  };
}

test('S6 schema persists per-device token hash and unique replay nonce', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  assert.equal(schema.includes('deviceTokenHash String?'), true);
  assert.equal(schema.includes('model AccessScanNonce'), true);
  assert.equal(schema.includes('@@unique([deviceId, nonce])'), true);
});

test('scan DTO requires device identity, secret, nonce and timestamp', async () => {
  const source = await readFile('src/modules/access/dto/scan.dto.ts', 'utf8');
  for (const field of ['deviceId: string', 'deviceToken: string', 'nonce: string', 'timestamp: number']) {
    assert.equal(source.includes(field), true, `missing ${field}`);
  }
});

test('inactive access device is denied and audited before credential evaluation', async () => {
  let credentialReads = 0;
  const prisma = basePrisma({
    accessDevice: {
      findUnique: async () => ({
        id: 'device-a',
        gymId: 'gym-a',
        active: false,
        deviceTokenHash: hash('device-secret'),
      }),
    },
    accessCredential: {
      findFirst: async () => {
        credentialReads += 1;
        return null;
      },
    },
  });

  const service = new AccessService(prisma);
  const result = await service.scan({
    qrToken: 'qr-token',
    deviceId: 'device-a',
    deviceToken: 'device-secret',
    nonce: 'nonce-1234567890123456',
    timestamp: Date.now(),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.denialReason, 'Dispositivo inativo');
  assert.equal(result.eventId, 'event-1');
  assert.equal(credentialReads, 0);
});

test('invalid device token is denied and audited', async () => {
  const prisma = basePrisma({
    accessDevice: {
      findUnique: async () => ({
        id: 'device-a',
        gymId: 'gym-a',
        active: true,
        deviceTokenHash: hash('correct-secret'),
      }),
    },
  });

  const service = new AccessService(prisma);
  const result = await service.scan({
    qrToken: 'qr-token',
    deviceId: 'device-a',
    deviceToken: 'wrong-secret',
    nonce: 'nonce-1234567890123456',
    timestamp: Date.now(),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.denialReason, 'Autenticacao do dispositivo invalida');
  assert.equal(result.eventId, 'event-1');
});

test('credential from Gym B cannot leak identity into Gym A event or response', async () => {
  let recordedEventData;
  const prisma = basePrisma({
    accessDevice: {
      findUnique: async () => ({
        id: 'device-a',
        gymId: 'gym-a',
        active: true,
        deviceTokenHash: hash('device-secret'),
      }),
    },
    accessCredential: {
      findFirst: async () => ({
        id: 'credential-b',
        studentId: 'student-b',
        active: true,
        expiresAt: null,
        student: {
          id: 'student-b',
          gymId: 'gym-b',
          status: 'ACTIVE',
          user: { name: 'Aluno B' },
        },
      }),
    },
    accessEvent: {
      create: async (args) => {
        recordedEventData = args.data;
        return { id: 'event-1', ...args.data };
      },
    },
  });

  const service = new AccessService(prisma);
  const result = await service.scan({
    qrToken: 'qr-token',
    deviceId: 'device-a',
    deviceToken: 'device-secret',
    nonce: 'nonce-1234567890123456',
    timestamp: Date.now(),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.denialReason, 'Credencial de outra academia');
  assert.equal(result.eventId, 'event-1');
  assert.equal(result.student, null);
  assert.equal(recordedEventData.studentId, null);
  assert.equal(JSON.stringify(result).includes('student-b'), false);
  assert.equal(JSON.stringify(result).includes('Aluno B'), false);
});

test('service contains durable replay rejection for Prisma unique nonce collision', async () => {
  const source = await readFile('src/modules/access/access.service.ts', 'utf8');
  assert.equal(source.includes("error.code === 'P2002'"), true);
  assert.equal(source.includes("denialReason: 'Replay detectado'"), true);
});
