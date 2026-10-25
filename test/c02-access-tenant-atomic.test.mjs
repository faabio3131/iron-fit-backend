import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Prisma } = require('@prisma/client');
const { AccessService } = require('../dist/src/modules/access/access.service.js');

function known(code) {
  return new Prisma.PrismaClientKnownRequestError('stale write', {
    code, clientVersion: '6.19.3',
  });
}

test('C02 credential revocation conditionally writes within tenant and audits once', async () => {
  let auditCount = 0, revoked = 0;
  const tx = {
    accessCredential: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { id: 'cred-a', student: { gymId: 'gym-a' } });
        return { id: 'cred-a', studentId: 'student-a', active: true };
      },
      update: async ({ where, data }) => {
        assert.deepEqual(where, { id: 'cred-a', active: true, student: { gymId: 'gym-a' } });
        assert.equal(data.active, false);
        revoked++;
        return { id: 'cred-a', active: false };
      },
    },
    auditLog: { create: async ({ data }) => {
      assert.equal(data.gymId, 'gym-a');
      auditCount++;
      return { id: 'audit-a' };
    } },
  };
  const service = new AccessService({
    $transaction: async (operation, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return operation(tx);
    },
  });
  const result = await service.revokeCredential('cred-a', 'gym-a', 'owner-a');
  assert.equal(result.active, false);
  assert.equal(result.status, 'INACTIVE');
  assert.equal(revoked, 1);
  assert.equal(auditCount, 1);
});

test('C02 credential revocation denies tenant mismatch before write', async () => {
  let writes = 0;
  const tx = {
    accessCredential: {
      findFirst: async ({ where }) => {
        assert.equal(where.student.gymId, 'gym-a');
        return null;
      },
      update: async () => { writes++; },
    },
  };
  const service = new AccessService({ $transaction: async op => op(tx) });
  await assert.rejects(
    () => service.revokeCredential('cred-b', 'gym-a'),
    error => error?.getStatus?.() === 404,
  );
  assert.equal(writes, 0);
});

test('C02 revoked credential is idempotent and produces no duplicate audit', async () => {
  let writes = 0, audited = 0;
  const tx = {
    accessCredential: {
      findFirst: async () => ({ id: 'cred-a', active: false }),
      update: async () => { writes++; },
    },
    auditLog: { create: async () => { audited++; } },
  };
  const service = new AccessService({ $transaction: async op => op(tx) });
  const value = await service.revokeCredential('cred-a', 'gym-a');
  assert.equal(value.status, 'INACTIVE');
  assert.equal(writes, 0);
  assert.equal(audited, 0);
});

test('C02 stale credential revocation returns conflict without recording success', async () => {
  let audited = 0;
  const tx = {
    accessCredential: {
      findFirst: async () => ({ id: 'cred-a', active: true }),
      update: async () => { throw known('P2025'); },
    },
    auditLog: { create: async () => { audited++; } },
  };
  const service = new AccessService({ $transaction: async op => op(tx) });
  await assert.rejects(
    () => service.revokeCredential('cred-a', 'gym-a'),
    error => error?.getStatus?.() === 409,
  );
  assert.equal(audited, 0);
});

test('C02 device secret rotation uses tenant/status CAS and stores only its hash', async () => {
  let saved, audited = 0;
  const tx = {
    accessDevice: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { id: 'device-a', gymId: 'gym-a', active: true });
        return { id: 'device-a' };
      },
      update: async ({ where, data }) => {
        assert.deepEqual(where, { id: 'device-a', gymId: 'gym-a', active: true });
        saved = data;
        return { id: 'device-a' };
      },
    },
    auditLog: { create: async ({ data }) => {
      audited++;
      assert.equal(data.action, 'ACCESS_DEVICE_TOKEN_ROTATED');
      assert.equal(JSON.stringify(data).includes('deviceToken'), false);
      return { id: 'audit-a' };
    } },
  };
  const service = new AccessService({
    $transaction: async (op, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return op(tx);
    },
  });
  const result = await service.provisionDeviceToken('device-a', 'gym-a', 'owner-a');
  assert.equal(result.deviceId, 'device-a');
  assert.equal(saved.deviceTokenHash, createHash('sha256').update(result.deviceToken).digest('hex'));
  assert.equal(audited, 1);
});

test('C02 device cannot be provisioned after tenant/status changes', async () => {
  let audited = 0;
  const tx = {
    accessDevice: {
      findFirst: async () => ({ id: 'device-a' }),
      update: async ({ where }) => {
        assert.equal(where.gymId, 'gym-a');
        assert.equal(where.active, true);
        throw known('P2025');
      },
    },
    auditLog: { create: async () => { audited++; } },
  };
  const service = new AccessService({ $transaction: async op => op(tx) });
  await assert.rejects(
    () => service.provisionDeviceToken('device-a', 'gym-a'),
    error => error?.getStatus?.() === 409,
  );
  assert.equal(audited, 0);
});
