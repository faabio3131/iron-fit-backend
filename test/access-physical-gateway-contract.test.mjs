import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { passageSignature } from '../scripts/physical-gateway-agent.mjs';

const require = createRequire(import.meta.url);
const { PhysicalGatewayService } = require('../dist/src/modules/access/hardware/physical-gateway.service.js');
const deviceToken = 'real-length-test-placeholder-secret-should-never-log';
const deviceId = '123e4567-e89b-12d3-a456-426614174000';
const gymId = 'gym-a';
const authId = 'auth-event-a';

function harness() {
  let attempt = {
    id: 'attempt-a', gymId, deviceId, manufacturer: 'HENRY',
    authorizationId: authId, state: 'AUTHORIZED',
    direction: 'ENTRY', createdAt: new Date(Date.now() - 1200),
    expiresAt: new Date(Date.now() + 15000),
  };
  const updates = [];
  const knownNonce = new Set();
  const prisma = {
    accessDevice: { findFirst: async ({ where }) =>
      where.id === deviceId && where.active === true
        ? { id: deviceId, gymId, manufacturer: 'HENRY',
          deviceTokenHash: createHash('sha256').update(deviceToken).digest('hex'), active: true }
        : null },
    accessScanNonce: { deleteMany: async () => ({ count: 0 }), create: async ({ data }) => {
      if (knownNonce.has(data.nonce)) throw new Error('reused nonce');
      knownNonce.add(data.nonce);
      return { id: data.nonce };
    } },
    physicalAccessAttempt: {
      findFirst: async ({ where }) => {
        if (where.gymId !== gymId || where.deviceId !== deviceId ||
            where.manufacturer !== 'HENRY' || where.state && where.state !== attempt.state ||
            where.authorizationId && where.authorizationId !== authId) return null;
        return attempt;
      },
      updateMany: async ({ where, data }) => {
        if (where.id !== attempt.id || where.gymId !== gymId ||
            where.deviceId !== deviceId || where.state !== attempt.state) return { count: 0 };
        if (where.expiresAt && attempt.expiresAt <= where.expiresAt.gt) return { count: 0 };
        attempt = { ...attempt, ...data };
        updates.push(data.state);
        return { count: 1 };
      },
    },
  };
  const coordinator = { decide: async () => ({ allowed: false, authorizationId: null }) };
  return { service: new PhysicalGatewayService(prisma, coordinator), getAttempt: () => attempt, updates };
}

let sequence = 0;
const auth = () => ({
  deviceId, deviceToken, nonce: 'nonce-for-gateway-test-' + (++sequence),
  timestamp: Date.now(),
});

test('remote SDK claim is scoped by device and atomic, with no second unlock', async () => {
  const h = harness();
  const first = await h.service.claim(auth());
  assert.equal(first.command.authorizationId, authId);
  assert.equal(first.command.manufacturer, 'HENRY');
  assert.equal(h.getAttempt().state, 'RELEASE_IN_FLIGHT');
  const second = await h.service.claim(auth());
  assert.equal(second.command, null);
  assert.deepEqual(h.updates, ['RELEASE_IN_FLIGHT']);
});

test('gateway release ACK is accepted once and passage only with bound HMAC proof', async () => {
  const h = harness();
  await h.service.claim(auth());
  assert.equal((await h.service.ack({ ...auth(), authorizationId: authId, status: 'ACCEPTED' })).accepted, true);
  assert.equal((await h.service.ack({ ...auth(), authorizationId: authId, status: 'ACCEPTED' })).accepted, false);
  const occurredAt = new Date().toISOString();
  const payload = {
    ...auth(), authorizationId: authId, vendorEventId: 'physical-evt-1',
    occurredAt, outcome: 'CONFIRMED',
  };
  payload.signature = passageSignature({
    deviceId, gymId, manufacturer: 'HENRY', authorizationId: authId,
    vendorEventId: payload.vendorEventId, occurredAt, outcome: 'CONFIRMED',
  }, deviceToken);
  assert.equal((await h.service.passage(payload)).confirmed, true);
  assert.equal(h.getAttempt().state, 'PASSAGE_CONFIRMED');
  assert.equal((await h.service.passage({ ...payload, nonce: 'fresh-anti-replay-nonce-2' })).confirmed, false);
});

test('missing SDK ACK is quarantined, no retry and no confirmed presence', async () => {
  const h = harness();
  await h.service.claim(auth());
  assert.equal((await h.service.ack({ ...auth(), authorizationId: authId, status: 'UNKNOWN' })).accepted, false);
  assert.equal(h.getAttempt().state, 'RELEASE_UNCERTAIN');
  assert.equal((await h.service.claim(auth())).command, null);
});

test('forged passage and invalid device token fail closed before persistence', async () => {
  const h = harness();
  await assert.rejects(() => h.service.claim({
    ...auth(), deviceToken: 'wrong-device-key-xxxxxxxxxxxxxxxxxxxx',
  }));
  assert.equal(h.getAttempt().state, 'AUTHORIZED');
  await h.service.claim(auth());
  await h.service.ack({ ...auth(), authorizationId: authId, status: 'ACCEPTED' });
  const occurredAt = new Date().toISOString();
  const request = {
    ...auth(), authorizationId: authId, vendorEventId: 'giro-1',
    occurredAt, outcome: 'CONFIRMED', signature: 'f'.repeat(64),
  };
  await assert.rejects(() => h.service.passage(request));
  assert.equal(h.getAttempt().state, 'COMMAND_ACCEPTED');
  assert.deepEqual(h.updates, ['RELEASE_IN_FLIGHT', 'COMMAND_ACCEPTED']);
});

test('gateway request signed for a different gym cannot authenticate passage', async () => {
  const h = harness();
  await h.service.claim(auth());
  await h.service.ack({ ...auth(), authorizationId: authId, status: 'ACCEPTED' });
  const occurredAt = new Date().toISOString();
  const request = {
    ...auth(), authorizationId: authId, vendorEventId: 'evt-1',
    occurredAt, outcome: 'CONFIRMED',
    signature: passageSignature({
      deviceId, gymId: 'gym-b', manufacturer: 'HENRY', authorizationId: authId,
      vendorEventId: 'evt-1', occurredAt, outcome: 'CONFIRMED',
    }, deviceToken),
  };
  await assert.rejects(() => h.service.passage(request));
  assert.equal(h.getAttempt().state, 'COMMAND_ACCEPTED');
});
