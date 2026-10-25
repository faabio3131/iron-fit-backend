import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AuthService } = require('../dist/src/modules/auth/auth.service.js');
const { hashOpaqueToken, refreshSessionName } = require('../dist/src/modules/auth/auth-security.js');

for (const legacy of [false, true]) {
  test(`C01 refresh rotation enforces idle and ${legacy ? 'legacy absolute' : 'absolute'} TTLs in CAS`, async () => {
    const secret = 'r'.repeat(64);
    const now = Date.now();
    const createdAt = new Date(now - 1000);
    const absoluteExpiresAt = legacy ? null : new Date(now + 60_000);
    let updateCalls = 0;
    let jwtCalls = 0;
    const prisma = {
      session: {
        findUnique: async () => ({
          id: 'session-1',
          userId: 'user-1',
          refreshTokenHash: hashOpaqueToken(secret),
          previousRefreshTokenHash: null,
          deviceName: refreshSessionName(null),
          expiresAt: new Date(now + 60_000),
          absoluteExpiresAt,
          createdAt,
          revokedAt: null,
        }),
        // Simulate the persisted session expiring between read and rotation.
        updateMany: async ({ where }) => {
          updateCalls += 1;
          assert.equal(where.id, 'session-1');
          assert.equal(where.revokedAt, null);
          assert.equal(where.refreshTokenHash, hashOpaqueToken(secret));
          assert.ok(where.expiresAt.gt instanceof Date);
          assert.ok(where.expiresAt.gt.getTime() >= now);
          if (legacy) {
            assert.equal(where.absoluteExpiresAt, undefined);
            assert.ok(where.createdAt.gt instanceof Date);
          } else {
            assert.equal(where.createdAt, undefined);
            assert.ok(where.absoluteExpiresAt.gt instanceof Date);
          }
          return { count: 0 };
        },
      },
      user: { findUnique: async () => ({
        id: 'user-1', active: true, emailVerifiedAt: new Date(),
        userRoles: [{
          gymId: null,
          gym: null,
          role: { name: 'SUPER_ADMIN', rolePermissions: [] },
        }],
      }) },
    };
    const service = new AuthService(
      prisma,
      { sign: () => { jwtCalls += 1; return 'jwt'; } },
      { get: () => undefined },
      { record: async () => {} },
      { requireVerifiedEmail: () => false },
      {},
    );
    await assert.rejects(
      () => service.refresh(`session-1.${secret}`),
      (error) => error?.getStatus?.() === 401,
    );
    assert.equal(updateCalls, 1);
    assert.equal(jwtCalls, 0);
  });
}
