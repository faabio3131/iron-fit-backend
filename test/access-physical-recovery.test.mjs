import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PhysicalAccessRecoveryService } =
  require('../dist/src/modules/access/hardware/physical-access-recovery.service.js');

test('recovery quarantines unknown SDK releases and expires stale operations, never replays commands', async () => {
  const calls = [];
  const prisma = {
    physicalAccessAttempt: {
      updateMany: async ({ where, data }) => {
        calls.push({ where, data });
        return { count: where.state === 'RELEASE_IN_FLIGHT' ? 2 : 4 };
      },
    },
  };
  const service = new PhysicalAccessRecoveryService(prisma);
  const now = new Date('2026-10-30T16:00:00.000Z');
  const result = await service.expireStale(now);
  assert.deepEqual(result, { uncertain: 2, expired: 4 });
  assert.equal(calls[0].data.state, 'RELEASE_UNCERTAIN');
  assert.equal(calls[1].data.state, 'EXPIRED');
  assert.deepEqual(calls[1].where.state.in, ['REQUESTED', 'AUTHORIZED', 'COMMAND_ACCEPTED']);
  assert.equal(calls.some(c => c.data.state === 'AUTHORIZED'), false);
});

test('uncertain operations are read only within authenticated gym, bounded and without secrets', async () => {
  let query;
  const prisma = { physicalAccessAttempt: {
    findMany: async (args) => { query = args; return []; },
  } };
  const service = new PhysicalAccessRecoveryService(prisma);
  assert.deepEqual(await service.listUncertain('gym-a', 2000), []);
  assert.deepEqual(query.where, { gymId: 'gym-a', state: 'RELEASE_UNCERTAIN' });
  assert.equal(query.take, 100);
  assert.equal(query.select.vendorEventId, undefined);
  assert.equal(query.select.authorizationId, true);
  await assert.rejects(() => service.listUncertain(''), /Academia/);
});
