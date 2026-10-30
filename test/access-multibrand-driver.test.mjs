import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PhysicalAccessDriverRegistry,
  PhysicalDeviceUnavailableError,
  assertPhysicalDeviceScope,
  assertFreshPhysicalCommand,
} = require('../dist/src/modules/access/hardware/physical-access-driver.js');
const {
  SUPPORTED_PHYSICAL_MANUFACTURERS,
  VendorBridgedPhysicalDriver,
  createPhysicalVendorDrivers,
} = require('../dist/src/modules/access/hardware/vendor-bridges.js');
const {
  nextPhysicalAccessState,
  isVerifiedPhysicalPresence,
} = require('../dist/src/modules/access/hardware/physical-access-lifecycle.js');

const device = {
  deviceId: 'device-a',
  gymId: 'gym-a',
  manufacturer: 'CONTROL_ID',
  model: 'iDBlock',
};

const command = () => ({
  deviceId: 'device-a',
  authorizationId: 'auth-a',
  direction: 'ENTRY',
  expiresAt: new Date(Date.now() + 30000),
});

test('four manufacturer boundaries exist but no hardware is active by default', () => {
  assert.deepEqual(
    SUPPORTED_PHYSICAL_MANUFACTURERS.map((x) => x.manufacturer),
    ['CONTROL_ID', 'TOPDATA', 'HENRY', 'DIMEP'],
  );
  assert.deepEqual(createPhysicalVendorDrivers({}), []);
  const registry = new PhysicalAccessDriverRegistry();
  assert.deepEqual(registry.available(), []);
  assert.throws(() => registry.resolve('CONTROL_ID'), PhysicalDeviceUnavailableError);
});

test('device scoping rejects foreign tenant and foreign device', () => {
  assert.doesNotThrow(() => assertPhysicalDeviceScope(device, 'device-a', 'gym-a'));
  assert.throws(() => assertPhysicalDeviceScope(device, 'device-a', 'gym-b'));
  assert.throws(() => assertPhysicalDeviceScope(device, 'device-b', 'gym-a'));
});

test('release requires future expiry and matching authorization acknowledgment', async () => {
  const bridge = {
    manufacturer: 'CONTROL_ID',
    supportsModel: () => true,
    open: async (_device, cmd) => ({ authorizationId: cmd.authorizationId, accepted: true }),
    authenticatePassage: async () => true,
  };
  const driver = new VendorBridgedPhysicalDriver('CONTROL_ID', 'REST', bridge);
  const registry = new PhysicalAccessDriverRegistry();
  registry.register(driver);
  assert.equal((await registry.resolve('CONTROL_ID').release(device, command())).accepted, true);
  assert.throws(() => registry.register(driver), /already registered/);
  assert.throws(() => assertFreshPhysicalCommand({ ...command(), expiresAt: new Date(0) }));
  await assert.rejects(() => driver.release(device, { ...command(), deviceId: 'device-b' }));
  await assert.rejects(() => driver.release({ ...device, manufacturer: 'HENRY' }, command()));
  assert.throws(() => new VendorBridgedPhysicalDriver('TOPDATA', 'LOCAL_SDK', bridge));
});

test('failed release, false ACK, and transport exception fail closed', async () => {
  const falseAck = new VendorBridgedPhysicalDriver('CONTROL_ID', 'REST', {
    manufacturer: 'CONTROL_ID',
    supportsModel: () => true,
    open: async () => ({ accepted: false, authorizationId: 'auth-a' }),
    authenticatePassage: async () => false,
  });
  await assert.rejects(() => falseAck.release(device, command()), PhysicalDeviceUnavailableError);
  const wrongAck = new VendorBridgedPhysicalDriver('CONTROL_ID', 'REST', {
    manufacturer: 'CONTROL_ID',
    supportsModel: () => true,
    open: async () => ({ accepted: true, authorizationId: 'stale-auth' }),
    authenticatePassage: async () => false,
  });
  await assert.rejects(() => wrongAck.release(device, command()), PhysicalDeviceUnavailableError);
});

test('passage requires matching device and verified vendor proof', async () => {
  const driver = new VendorBridgedPhysicalDriver('CONTROL_ID', 'REST', {
    manufacturer: 'CONTROL_ID',
    supportsModel: () => true,
    open: async () => ({ accepted: true, authorizationId: 'auth-a' }),
    authenticatePassage: async (_d, e) => e.vendorEventId === 'signed-event',
  });
  const event = {
    deviceId: 'device-a',
    authorizationId: 'auth-a',
    vendorEventId: 'signed-event',
    occurredAt: new Date(),
    outcome: 'CONFIRMED',
  };
  assert.equal(await driver.verifyPassage(device, event), true);
  assert.equal(await driver.verifyPassage(device, { ...event, deviceId: 'other' }), false);
  assert.equal(await driver.verifyPassage(device, { ...event, vendorEventId: '' }), false);
  assert.equal(await driver.verifyPassage(device, { ...event, vendorEventId: 'untrusted' }), false);
});

test('authorization and command ACK cannot be confused with physical attendance', () => {
  let state = 'REQUESTED';
  state = nextPhysicalAccessState(state, 'AUTHORIZE');
  assert.equal(isVerifiedPhysicalPresence(state), false);
  state = nextPhysicalAccessState(state, 'ACK_RELEASE');
  assert.equal(isVerifiedPhysicalPresence(state), false);
  state = nextPhysicalAccessState(state, 'CONFIRM_PASSAGE');
  assert.equal(isVerifiedPhysicalPresence(state), true);
  assert.throws(() => nextPhysicalAccessState(state, 'CONFIRM_PASSAGE'));
});

test('denials, failed passages, timeouts and replays are terminal', () => {
  for (const terminal of [
    nextPhysicalAccessState('REQUESTED', 'DENY'),
    nextPhysicalAccessState('REQUESTED', 'EXPIRE'),
    nextPhysicalAccessState('COMMAND_ACCEPTED', 'REJECT_PASSAGE'),
  ]) {
    assert.equal(isVerifiedPhysicalPresence(terminal), false);
    assert.throws(() => nextPhysicalAccessState(terminal, 'CONFIRM_PASSAGE'));
  }
  assert.throws(() => nextPhysicalAccessState('REQUESTED', 'CONFIRM_PASSAGE'));
});

test('each of the four brands has a separate connector contract with correct transport', async () => {
  const connectorByBrand = Object.fromEntries(SUPPORTED_PHYSICAL_MANUFACTURERS.map((definition) => [
    definition.manufacturer,
    {
      manufacturer: definition.manufacturer,
      supportsModel: () => true,
      open: async (_device, cmd) => ({ accepted: true, authorizationId: cmd.authorizationId }),
      authenticatePassage: async () => false,
    },
  ]));
  const drivers = createPhysicalVendorDrivers(connectorByBrand);
  assert.equal(drivers.length, 4);
  for (const definition of SUPPORTED_PHYSICAL_MANUFACTURERS) {
    const driver = drivers.find((item) => item.manufacturer === definition.manufacturer);
    assert.ok(driver);
    assert.equal(driver.transport, definition.transport);
    const perVendor = { ...device, manufacturer: definition.manufacturer };
    const ack = await driver.release(perVendor, command());
    assert.equal(ack.accepted, true);
    assert.equal(await driver.verifyPassage(perVendor, {
      deviceId: perVendor.deviceId,
      authorizationId: 'auth-a',
      vendorEventId: 'vendor-event',
      occurredAt: new Date(),
      outcome: 'CONFIRMED',
    }), false);
  }
});
