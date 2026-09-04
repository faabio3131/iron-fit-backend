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
      create: async () => ({}),
      ...overrides.user,
    },
    auditLog: {
      count: async () => 0,
      create: async () => ({}),
      ...overrides.auditLog,
    },
    session: {
      create: async () => ({ id: 'session-1' }),
      findUnique: async () => null,
      updateMany: async () => ({ count: 1 }),
      ...overrides.session,
    },
  };
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

test('refresh sessions are explicitly separated from student onboarding sessions', async () => {
  const secret = 'r'.repeat(64);
  const prisma = prismaBase({
    session: {
      findUnique: async () => ({
        id: 'session-1',
        userId: 'user-1',
        refreshTokenHash: hashOpaqueToken(secret),
        deviceName: 'STUDENT_ONBOARDING',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      }),
    },
  });
  const service = new AuthService(prisma, { sign: () => 'jwt' });
  await assert.rejects(() => service.refresh(`session-1.${secret}`), /Refresh token invalido/);
});

test('refresh rotates the stored token atomically and returns a new access token', async () => {
  const oldSecret = 'o'.repeat(64);
  let updateWhere;
  const prisma = prismaBase({
    session: {
      findUnique: async () => ({
        id: 'session-1',
        userId: 'user-1',
        refreshTokenHash: hashOpaqueToken(oldSecret),
        deviceName: refreshSessionName(null),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      }),
      updateMany: async (args) => {
        updateWhere = args.where;
        return { count: 1 };
      },
    },
    user: {
      findUnique: async () => ({
        id: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
        active: true,
        userRoles: [
          {
            gymId: null,
            gym: null,
            role: { name: 'SUPER_ADMIN', rolePermissions: [] },
          },
        ],
      }),
    },
  });
  const service = new AuthService(prisma, { sign: () => 'new-jwt' });
  const result = await service.refresh(`session-1.${oldSecret}`);

  assert.equal(result.access_token, 'new-jwt');
  assert.equal(result.refresh_token.startsWith('session-1.'), true);
  assert.notEqual(result.refresh_token, `session-1.${oldSecret}`);
  assert.equal(updateWhere.id, 'session-1');
  assert.equal(updateWhere.refreshTokenHash, hashOpaqueToken(oldSecret));
});

test('login brute-force protection blocks before password/user lookup after threshold', async () => {
  let userReads = 0;
  const prisma = prismaBase({
    auditLog: { count: async () => 5, create: async () => ({}) },
    user: {
      findUnique: async () => {
        userReads += 1;
        return null;
      },
    },
  });
  const service = new AuthService(prisma, { sign: () => 'jwt' });
  await assert.rejects(() => service.validateUser('victim@example.com', 'bad-password'), /Credenciais invalidas/);
  assert.equal(userReads, 0);
});

test('logout revokes only AUTH_REFRESH session matching the presented token', async () => {
  const secret = 'z'.repeat(64);
  let revokeWhere;
  const prisma = prismaBase({
    session: {
      findUnique: async () => ({
        id: 'session-1',
        userId: 'user-1',
        refreshTokenHash: hashOpaqueToken(secret),
        deviceName: refreshSessionName('gym-a'),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      }),
      updateMany: async (args) => {
        revokeWhere = args.where;
        return { count: 1 };
      },
    },
  });
  const service = new AuthService(prisma, { sign: () => 'jwt' });
  const result = await service.logout(`session-1.${secret}`);
  assert.deepEqual(result, { revoked: true });
  assert.deepEqual(revokeWhere, { id: 'session-1', revokedAt: null });
});
