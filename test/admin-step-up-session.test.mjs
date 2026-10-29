import test from 'node:test';
import assert from 'node:assert/strict';

const { StepUpService, ADMIN_STEP_UP_TTL_MS } = await import('../dist/src/modules/auth/step-up.service.js');

function prismaForSession({ updateCount = 1, storedExpiry = null, revoked = false } = {}) {
  let expiry = storedExpiry;
  return {
    readExpiry: () => expiry,
    session: {
      updateMany: async ({ where, data }) => {
        assert.equal(where.revokedAt, null);
        if (updateCount === 1) expiry = data.stepUpExpiresAt;
        return { count: updateCount };
      },
      findFirst: async ({ where }) => {
        if (revoked || where.id !== 'session-1' || where.userId !== 'user-1') return null;
        return { stepUpExpiresAt: expiry };
      },
    },
  };
}

test('administrative step-up is bound to the current session with a 15 minute TTL', async () => {
  const prisma = prismaForSession();
  const service = new StepUpService(prisma);
  const before = Date.now();
  const granted = await service.grant('user-1', 'session-1');
  const after = Date.now();

  assert.equal(granted.active, true);
  assert.ok(granted.expiresAt.getTime() >= before + ADMIN_STEP_UP_TTL_MS);
  assert.ok(granted.expiresAt.getTime() <= after + ADMIN_STEP_UP_TTL_MS);
  assert.equal((await service.status('user-1', 'session-1')).active, true);
});

test('expired administrative step-up is fail-closed', async () => {
  const prisma = prismaForSession({ storedExpiry: new Date(Date.now() - 1_000) });
  const service = new StepUpService(prisma);

  const state = await service.status('user-1', 'session-1');
  assert.equal(state.active, false);
  await assert.rejects(
    () => service.assertActive('user-1', 'session-1'),
    (error) => error?.status === 403,
  );
});

test('revoked or mismatched session cannot use or receive administrative step-up', async () => {
  const revokedPrisma = prismaForSession({ revoked: true });
  const revokedService = new StepUpService(revokedPrisma);
  assert.equal((await revokedService.status('user-1', 'session-1')).active, false);

  const invalidPrisma = prismaForSession({ updateCount: 0 });
  const invalidService = new StepUpService(invalidPrisma);
  await assert.rejects(
    () => invalidService.grant('user-1', 'session-1'),
    (error) => error?.status === 401,
  );
});
