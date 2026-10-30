import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  TopdataEasyInnerBridge,
  HenrySdkBridge,
  DimepSdkBridge,
  signSdkPassage,
  verifySdkPassage,
} = require('../dist/src/modules/access/hardware/native-sdk-vendor-bridges.js');

const constructors = [
  ['TOPDATA', TopdataEasyInnerBridge],
  ['HENRY', HenrySdkBridge],
  ['DIMEP', DimepSdkBridge],
];

for (const [brand, Adapter] of constructors) {
  test(`${brand}: rejects absent SDK attestation, model, firmware and mismatched brand`, async () => {
    const key = randomBytes(32);
    const sdk = {
      manufacturer: brand, gatewayId: 'gateway-a', sdkVersion: 'version-from-vendor',
      attested: true, certifiedModels: new Set(['supported-model']),
      certifiedFirmwareVersions: new Set(['approved-firmware']),
      releaseBySdk: async (command) => ({ accepted: true, authorizationId: command.authorizationId }),
    };
    const bridge = new Adapter(sdk, key, async () => null);
    assert.equal(bridge.supportsModel('supported-model', 'approved-firmware'), true);
    assert.equal(bridge.supportsModel('supported-model', ''), false);
    assert.equal(bridge.supportsModel('unverified-model', 'approved-firmware'), false);
    assert.equal(bridge.supportsModel('supported-model', 'other-firmware'), false);
    assert.throws(() => new Adapter({ ...sdk, attested: false }, key, async () => null));
    assert.throws(() => new Adapter({ ...sdk, manufacturer: 'CONTROL_ID' }, key, async () => null));
    await assert.rejects(() => bridge.open({
      deviceId: 'device-a', gymId: 'gym-a', manufacturer: brand,
      model: 'unverified-model', protocolVersion: 'approved-firmware',
    }, {
      deviceId: 'device-a', authorizationId: 'a1', direction: 'ENTRY',
      expiresAt: new Date(Date.now() + 10000),
    }));
  });

  test(`${brand}: SDK gets scoped command; only signed giro confirms attendance`, async () => {
    const key = randomBytes(32);
    let opened = 0;
    const sdk = {
      manufacturer: brand, gatewayId: 'gateway-a', sdkVersion: 'vendor-v1',
      attested: true, certifiedModels: new Set(['supported-model']),
      certifiedFirmwareVersions: new Set(['approved-firmware']),
      releaseBySdk: async (command) => {
        opened++;
        return { accepted: true, authorizationId: command.authorizationId };
      },
    };
    const device = {
      deviceId: 'device-a', gymId: 'gym-a', manufacturer: brand,
      model: 'supported-model', protocolVersion: 'approved-firmware',
    };
    const command = {
      deviceId: 'device-a', authorizationId: 'authorization-a', direction: 'ENTRY',
      expiresAt: new Date(Date.now() + 5000),
    };
    let signed;
    const bridge = new Adapter(sdk, key, async () => signed ?? null);
    assert.equal((await bridge.open(device, command)).accepted, true);
    assert.equal(opened, 1);
    const passage = {
      deviceId: 'device-a', authorizationId: 'authorization-a',
      vendorEventId: 'vendor-evt-1', occurredAt: new Date(), outcome: 'CONFIRMED',
    };
    signed = {
      gatewayId: 'gateway-a', deviceId: passage.deviceId, manufacturer: brand,
      authorizationId: passage.authorizationId, vendorEventId: passage.vendorEventId,
      occurredAt: passage.occurredAt.toISOString(), outcome: passage.outcome,
    };
    signed.signature = signSdkPassage(signed, key);
    assert.equal(verifySdkPassage(signed, key), true);
    assert.equal(await bridge.authenticatePassage(device, passage), true);
    assert.equal(await bridge.authenticatePassage(device, passage), false);
    assert.equal(await bridge.authenticatePassage(device, { ...passage, vendorEventId: 'forged' }), false);
    assert.equal(await bridge.authenticatePassage({ ...device, deviceId: 'other' }, passage), false);
    assert.equal(verifySdkPassage({ ...signed, outcome: 'DENIED' }, key), false);
    assert.equal(verifySdkPassage({ ...signed, signature: 'bad' }, key), false);
  });
}
