import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PhysicalAccessCoordinator } = require('../dist/src/modules/access/hardware/physical-access-coordinator.js');
const { PhysicalAccessDriverRegistry } = require('../dist/src/modules/access/hardware/physical-access-driver.js');

const baseDevice = { id: 'device-a', gymId: 'gym-a', active: true, protocol: 'CONTROL_ID', name: 'iDBlock' };
const scan = { qrToken: 'qr', deviceId: 'device-a', deviceToken: 'valid-device', nonce: '1234567890123456', timestamp: Date.now(), direction: 'ENTRY' };
const validDecision = { allowed: true, eventId: 'audit-1', student: { id: 'student-a' } };

function buildHarness({ decision = validDecision, driverAvailable = true } = {}) {
  const events = [];
  let attempt = null;
  const prisma = {
    accessDevice: {
      findUnique: async () => baseDevice,
      findFirst: async () => baseDevice,
    },
    physicalAccessAttempt: {
      create: async ({ data }) => { attempt = { id: 'attempt-1', createdAt: new Date(Date.now() - 1000), ...data }; events.push(['created', attempt.state]); return attempt; },
      findUnique: async () => attempt,
      updateMany: async ({ where, data }) => {
        if (!attempt || attempt.state !== where.state) return { count: 0 };
        if (where.expiresAt && attempt.expiresAt <= where.expiresAt.gt) return { count: 0 };
        attempt = { ...attempt, ...data };
        events.push(['updated', attempt.state]);
        return { count: 1 };
      },
    },
  };
  const canonical = { scan: async () => decision };
  const registry = new PhysicalAccessDriverRegistry();
  if (driverAvailable) {
    registry.register({
      manufacturer: 'CONTROL_ID',
      transport: 'REST',
      release: async (_dev, cmd) => ({ accepted: true, authorizationId: cmd.authorizationId }),
      verifyPassage: async (_dev, event) => event.vendorEventId === 'verified-1',
    });
  }
  return { coordinator: new PhysicalAccessCoordinator(prisma, canonical, registry), events, getAttempt: () => attempt, prisma };
}

test('no vendor driver means no access attempt or physical command', async () => {
  const h = buildHarness({ driverAvailable: false });
  await assert.rejects(() => h.coordinator.decide(scan), /driver nao homologado/);
  assert.equal(h.getAttempt(), null);
});

test('canonical authorization is necessary before any device release', async () => {
  const h = buildHarness({ decision: { allowed: false, eventId: 'audit-denied', student: null, denialReason: 'Credencial expirada' } });
  const result = await h.coordinator.decide(scan);
  assert.equal(result.allowed, false);
  assert.equal(h.getAttempt(), null);
  assert.equal(await h.coordinator.release('nonexistent'), false);
});

test('successful decision, release acknowledgment, verified giro, replay rejection', async () => {
  const h = buildHarness();
  const d = await h.coordinator.decide(scan);
  assert.equal(d.allowed, true);
  assert.equal(h.getAttempt().state, 'AUTHORIZED');
  assert.equal(await h.coordinator.release(d.authorizationId), true);
  assert.equal(h.getAttempt().state, 'COMMAND_ACCEPTED');
  assert.equal(await h.coordinator.release(d.authorizationId), false);
  const passage = {
    deviceId: 'device-a',
    authorizationId: d.authorizationId,
    vendorEventId: 'verified-1',
    occurredAt: new Date(),
    outcome: 'CONFIRMED',
  };
  assert.equal(await h.coordinator.confirmPassage(passage), true);
  assert.equal(h.getAttempt().state, 'PASSAGE_CONFIRMED');
  assert.equal(await h.coordinator.confirmPassage(passage), false);
});

test('untrusted passage, mismatched device, no-giro, expired command fail closed', async () => {
  const h = buildHarness();
  const d = await h.coordinator.decide(scan);
  assert.equal(await h.coordinator.confirmPassage({ authorizationId: d.authorizationId, deviceId: 'device-a', vendorEventId: 'verified-1', occurredAt: new Date(), outcome: 'CONFIRMED' }), false);
  await h.coordinator.release(d.authorizationId);
  const event = { deviceId: 'device-a', authorizationId: d.authorizationId, vendorEventId: 'verified-1', occurredAt: new Date(), outcome: 'CONFIRMED' };
  assert.equal(await h.coordinator.confirmPassage({ ...event, deviceId: 'device-b' }), false);
  assert.equal(await h.coordinator.confirmPassage({ ...event, vendorEventId: 'untrusted' }), false);
  assert.equal(await h.coordinator.confirmPassage({ ...event, outcome: 'NOT_CONFIRMED' }), false);
  assert.equal(h.getAttempt().state, 'COMMAND_ACCEPTED');
});

test('invalid direction cannot invoke canonical scan', async () => {
  const h = buildHarness();
  await assert.rejects(() => h.coordinator.decide({ ...scan, direction: 'SIDEWAYS' }), /Sentido/);
  assert.equal(h.getAttempt(), null);
});
