import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AuthService } = require('../dist/src/modules/auth/auth.service.js');
const { hashOpaqueToken, REFRESH_SESSION_PREFIX } = require('../dist/src/modules/auth/auth-security.js');

test('stale logout cannot revoke a concurrently refreshed session', async () => {
  const originalHash = hashOpaqueToken('original-secret');
  let actualHash = originalHash;
  let revoked = false;
  let audited = false;
  const prisma = { session: {
    findUnique: async () => {
      actualHash = hashOpaqueToken('rotated-secret');
      return { id: 's1', userId: 'u1', refreshTokenHash: originalHash,
        deviceName: REFRESH_SESSION_PREFIX + 'gym-a' };
    },
    updateMany: async ({ where }) => {
      assert.equal(where.refreshTokenHash, originalHash);
      if (where.refreshTokenHash !== actualHash) return { count: 0 };
      revoked = true;
      return { count: 1 };
    },
  } };
  const svc = new AuthService(prisma, {}, {}, { record: async () => { audited = true; } }, {}, {});
  assert.deepEqual(await svc.logout('s1.original-secret'), { revoked: true });
  assert.equal(revoked, false);
  assert.equal(audited, false);
});

test('logout with the current refresh token revokes the session', async () => {
  const hash = hashOpaqueToken('valid-secret');
  let revoked = false;
  const prisma = { session: {
    findUnique: async () => ({ id: 's2', userId: 'u2', refreshTokenHash: hash,
      deviceName: REFRESH_SESSION_PREFIX + 'gym-a' }),
    updateMany: async ({ where }) => {
      assert.equal(where.refreshTokenHash, hash);
      revoked = true;
      return { count: 1 };
    },
  } };
  const svc = new AuthService(prisma, {}, {}, { record: async () => {} }, {}, {});
  assert.deepEqual(await svc.logout('s2.valid-secret'), { revoked: true });
  assert.equal(revoked, true);
});
