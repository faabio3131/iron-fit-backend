import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CommunicationDispatchService } = require('../dist/src/modules/communication/communication-dispatch.service.js');

function createService(prisma, audits = []) {
  return new CommunicationDispatchService(
    prisma,
    { require: () => { throw new Error('must never dispatch'); } },
    { current: () => 'HOMOLOG' },
    {},
    { record: async (entry) => audits.push(entry) },
  );
}

test('expired SENDING lease becomes a quarantined FAILED outcome with no duplicate WhatsApp dispatch', async () => {
  const audits = [];
  let recoveredState;
  let retryFilter;
  const expired = new Date(Date.now() - 60_000);
  const service = createService({
    communicationMessage: {
      findMany: async ({ where }) => {
        if (where.status === 'SENDING') return [{
          id: 'message-a', gymId: 'gym-a', dispatchLeaseOwner: 'worker-dead',
          dispatchLeaseUntil: expired,
        }];
        retryFilter = where;
        return [];
      },
      updateMany: async ({ where, data }) => {
        assert.equal(where.id, 'message-a');
        assert.equal(where.status, 'SENDING');
        assert.equal(where.dispatchLeaseOwner, 'worker-dead');
        assert.equal(where.dispatchLeaseUntil, expired);
        recoveredState = data;
        return { count: 1 };
      },
    },
  }, audits);

  const cycle = await service.runCycle();
  assert.equal(cycle.recovered, 1);
  assert.deepEqual(cycle.results, []);
  assert.equal(recoveredState.status, 'FAILED');
  assert.equal(recoveredState.nextAttemptAt, null);
  assert.equal(recoveredState.dispatchLeaseOwner, null);
  assert.equal(recoveredState.dispatchLeaseUntil, null);
  assert.equal(recoveredState.lastErrorCode, 'DELIVERY_OUTCOME_UNKNOWN');
  assert.deepEqual(retryFilter.OR, [
    { lastErrorCode: null },
    { lastErrorCode: { not: 'DELIVERY_OUTCOME_UNKNOWN' } },
  ]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].gymId, 'gym-a');
  assert.equal(audits[0].action, 'COMMUNICATION_DELIVERY_OUTCOME_UNKNOWN');
  assert.doesNotMatch(JSON.stringify(audits), /recipient|phone|credential|body/i);
});

test('lease recovery never changes a message claimed or finalized by another worker', async () => {
  const audits = [];
  const service = createService({
    communicationMessage: {
      findMany: async () => [{ id: 'message-b', gymId: 'gym-b', dispatchLeaseOwner: 'old-worker', dispatchLeaseUntil: new Date(0) }],
      updateMany: async ({ where }) => {
        assert.equal(where.dispatchLeaseOwner, 'old-worker');
        return { count: 0 };
      },
    },
  }, audits);
  assert.equal(await service.recoverExpiredLeases(), 0);
  assert.equal(audits.length, 0);
});

test('direct dispatchOne cannot reacquire an uncertain expired delivery', async () => {
  let filter;
  const service = createService({
    communicationMessage: {
      updateMany: async ({ where }) => {
        filter = where;
        return { count: 0 };
      },
    },
  });
  const result = await service.dispatchOne('message-c');
  assert.equal(result.dispatched, false);
  assert.deepEqual(filter.OR, [
    { lastErrorCode: null },
    { lastErrorCode: { not: 'DELIVERY_OUTCOME_UNKNOWN' } },
  ]);
});
