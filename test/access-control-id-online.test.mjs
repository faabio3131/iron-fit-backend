import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseControlIdQrEvent, controlIdOnlineDecision } =
  require('../dist/src/modules/access/hardware/control-id-online.js');

const payload = {
  device_id: '123456', portal_id: '1', time: '1793372400',
  uuid: '123e4567-e89b-12d3-a456-426614174000',
  qrcode_value: 'abcdef1234567890abcdef1234567890abcdef1234567890',
};

test('Control iD online QR payload preserves device, portal and credential for canonical scanner', () => {
  const p = parseControlIdQrEvent(payload);
  assert.equal(p.device_id, 123456);
  assert.equal(p.portal_id, 1);
  assert.equal(p.qrcode_value, payload.qrcode_value);
  assert.equal(p.uuid, payload.uuid);
});

test('Control iD malformed payload and arbitrary credential format are rejected', () => {
  for (const bad of [
    { ...payload, qrcode_value: '1' },
    { ...payload, uuid: 'a' },
    { ...payload, device_id: '-1' },
    { ...payload, portal_id: 'NaN' },
    { ...payload, time: 'invalid' },
  ]) assert.throws(() => parseControlIdQrEvent(bad));
});

test('Control iD negative decision never contains turnstile action', () => {
  const result = controlIdOnlineDecision(parseControlIdQrEvent(payload), false, true, 'ENTRY');
  assert.equal(result.result.event, 6);
  assert.deepEqual(result.result.actions, []);
});

test('Control iD allows correct direction only after canonical authorization', () => {
  const e = parseControlIdQrEvent(payload);
  assert.deepEqual(controlIdOnlineDecision(e, true, true, 'ENTRY').result.actions, [
    { action: 'catra', parameters: 'allow=clockwise' },
  ]);
  assert.deepEqual(controlIdOnlineDecision(e, true, false, 'ENTRY').result.actions, [
    { action: 'catra', parameters: 'allow=anticlockwise' },
  ]);
  assert.deepEqual(controlIdOnlineDecision(e, true, true, 'EXIT').result.actions, [
    { action: 'catra', parameters: 'allow=anticlockwise' },
  ]);
});
