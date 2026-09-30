import test from 'node:test';
import assert from 'node:assert/strict';

const { StepUpService } = await import('../dist/src/modules/auth/step-up.service.js');

test('administrative step-up is session-bound and expires', async () => {
  let storedExpiry = null;
  const prisma = {
    session: {
      updateMany: async ({ where, data }) => {
        assert.equal(where.id, 'session-1');
        assert.equal(where.userId, 'user-1');
        storedExpiry = data.stepUpExpiresAt;
        return { count: 1 };
      },
      findFirst: async ({ where }) => {
        if (where.id !== 'session-1' || where.userId !== 'user-1') return null;
        return { stepUpExpiresAt: storedExpiry };
      },
    },
  };
  const service = new StepUpService(prisma);
  const granted = await service.grant('user-1', 'session-1');
  assert.equal(granted.active, true);
  assert.ok(granted.expiresAt > new Date());
  assert.equal((await service.status('user-1', 'session-1')).active, true);
});
