import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AuthService } = require('../dist/src/modules/auth/auth.service.js');
const {
  hashOpaqueToken,
  requireJwtSecret,
  refreshSessionName,
} = require('../dist/src/modules/auth/auth-security.js');

function prismaBase(overrides = {}) {
  return {
    user: {
      findUnique: async () => null,
      update: async () => ({}),
      ...overrides.user,
    },
    auditLog: {
      create: async () => ({}),
      ...overrides.auditLog,
    },
    session: {
      create: async () => ({}),
      findUnique: async () => null,
      findMany: async () => [],
      updateMany: async () => ({ count: 1 }),
      ...overrides.session,
    },
    authActionToken: {
      updateMany: async () => ({ count: 0 }),
      create: async () => ({}),
      findUnique: async () => null,
      ...overrides.authActionToken,
    },
    $transaction: async (fn) => fn({
      ...prismaBase(overrides),
      $transaction: undefined,
    }),
  };
}

function authService(prisma, jwt = { sign: () => 'jwt' }, securityOverrides = {}) {
  const security = {
    assertLoginAllowed: async () => undefined,
    recordLoginFailure: async () => undefined,
    recordLoginSuccess: async () => undefined,
    requireVerifiedEmail: () => false,
    verifySecondFactor: async () => true,
    ...securityOverrides,
  };
  return new AuthService(
    prisma,
    jwt,
    { get: () => undefined },
    { record: async () => ({}) },
    security,
  );
}

test('S8 removes dev JWT secret fallback and requires a strong configured secret', async () => {
  const moduleSource = await readFile('src/modules/auth/auth.module.ts', 'utf8');
  const strategySource = await readFile('src/modules/auth/strategies/jwt.strategy.ts', 'utf8');
  assert.equal(moduleSource.includes('dev_secret_fallback'), false);
  assert.equal(strategySource.includes('dev_secret_fallback'), false);

  assert.throws(() => requireJwtSecret({ get: () => undefined }), /JWT_SECRET/);
  assert.throws(() => requireJwtSecret({ get: () => 'short' }), /JWT_SECRET/);
  assert.equal(requireJwtSecret({ get: () => 'x'.repeat(40) }), 'x'.repeat(40));
});

test('refresh sessions remain separated from student onboarding sessions', async () => {
  const secret = 'r'.repeat(64);
  const now = new Date();
  const prisma = prismaBase({
    session: {
      findUnique: async () => ({
        id: 'session-1',
        userId: 'user-1',
        refreshTokenHash: hashOpaqueToken(secret),
        previousRefreshTokenHash: null,
        deviceName: 'STUDENT_ONBOARDING',
        expiresAt: new Date(now.getTime() + 60_000),
        absoluteExpiresAt: new Date(now.getTime() + 120_000),
        createdAt: now,
        revokedAt: null,
      }),
    },
  });
  await assert.rejects(
    () => authService(prisma).refresh(`session-1.${secret}`),
    /Refresh token invalido/,
  );
});

test('refresh rotates atomically, preserves absolute lifetime and returns sid-bound access token', async () => {
  const oldSecret = 'o'.repeat(64);
  const now = new Date();
  let updateWhere;
  let updateData;
  let signedPayload;
  const prisma = prismaBase({
    session: {
      findUnique: async () => ({
        id: 'session-1',
        userId: 'user-1',
        refreshTokenHash: hashOpaqueToken(oldSecret),
        previousRefreshTokenHash: null,
        deviceName: refreshSessionName(null),
        expiresAt: new Date(now.getTime() + 60_000),
        absoluteExpiresAt: new Date(now.getTime() + 120_000),
        createdAt: now,
        revokedAt: null,
      }),
      updateMany: async (args) => {
        updateWhere = args.where;
        updateData = args.data;
        return { count: 1 };
      },
    },
    user: {
      findUnique: async () => ({
        id: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
        active: true,
        emailVerifiedAt: now,
        userRoles: [{
          gymId: null,
          gym: null,
          role: { name: 'SUPER_ADMIN', rolePermissions: [] },
        }],
      }),
    },
  });
  const service = authService(prisma, {
    sign: (payload) => {
      signedPayload = payload;
      return 'new-jwt';
    },
  });
  const result = await service.refresh(`session-1.${oldSecret}`);

  assert.equal(result.access_token, 'new-jwt');
  assert.equal(result.refresh_token.startsWith('session-1.'), true);
  assert.equal(updateWhere.refreshTokenHash, hashOpaqueToken(oldSecret));
  assert.equal(updateData.previousRefreshTokenHash, hashOpaqueToken(oldSecret));
  assert.equal(updateData.absoluteExpiresAt.getTime(), now.getTime() + 120_000);
  assert.equal(signedPayload.sid, 'session-1');
});

test('previous refresh token replay revokes the whole session family', async () => {
  const oldSecret = 'p'.repeat(64);
  let revoked = false;
  const now = new Date();
  const prisma = prismaBase({
    session: {
      findUnique: async () => ({
        id: 'session-1',
        userId: 'user-1',
        refreshTokenHash: hashOpaqueToken('n'.repeat(64)),
        previousRefreshTokenHash: hashOpaqueToken(oldSecret),
        deviceName: refreshSessionName('gym-a'),
        expiresAt: new Date(now.getTime() + 60_000),
        absoluteExpiresAt: new Date(now.getTime() + 120_000),
        createdAt: now,
        revokedAt: null,
      }),
      updateMany: async () => {
        revoked = true;
        return { count: 1 };
      },
    },
  });
  await assert.rejects(
    () => authService(prisma).refresh(`session-1.${oldSecret}`),
    /Refresh token invalido/,
  );
  assert.equal(revoked, true);
});

test('logout revokes only matching AUTH_REFRESH session', async () => {
  const secret = 'z'.repeat(64);
  let revokeWhere;
  const now = new Date();
  const prisma = prismaBase({
    session: {
      findUnique: async () => ({
        id: 'session-1',
        userId: 'user-1',
        refreshTokenHash: hashOpaqueToken(secret),
        deviceName: refreshSessionName('gym-a'),
        expiresAt: new Date(now.getTime() + 60_000),
        absoluteExpiresAt: new Date(now.getTime() + 120_000),
        createdAt: now,
        revokedAt: null,
      }),
      updateMany: async (args) => {
        revokeWhere = args.where;
        return { count: 1 };
      },
    },
  });
  const result = await authService(prisma).logout(`session-1.${secret}`);
  assert.deepEqual(result, { revoked: true });
  assert.deepEqual(revokeWhere, { id: 'session-1', revokedAt: null });
});
