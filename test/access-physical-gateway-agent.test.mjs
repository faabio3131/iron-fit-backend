import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  IronPhysicalGatewayClient,
  gatewayOrigin,
  passageSignature,
} from '../scripts/physical-gateway-agent.mjs';

const origin = 'https://api.example.org';
const deviceId = '123e4567-e89b-12d3-a456-426614174000';
const token = 'local-secret-placeholder-not-an-actual-key-123456789';
const authId = 'access-event-1';

test('Windows SDK gateway requires HTTPS origin, preconfigured authenticated SDK and secret', () => {
  assert.equal(gatewayOrigin(origin), origin);
  for (const url of ['http://localhost', 'https://u:p@example.org/', 'https://example.org/path', 'https://example.org/?token=secret']) {
    assert.throws(() => gatewayOrigin(url));
  }
  assert.throws(() => new IronPhysicalGatewayClient({
    origin, deviceId, token, sdk: { manufacturer: 'HENRY' },
  }), /SDK local/);
});

function createCase(options = {}) {
  const calls = [];
  let releases = 0;
  let identifications = 0;
  const sdk = {
    manufacturer: options.manufacturer || 'HENRY',
    model: 'certified-model',
    firmware: 'approved-firmware',
    readIdentification: async () => {
      identifications++;
      return identifications === 1 ? { qrToken: 'qr-credential-opaque', direction: 'ENTRY' } : null;
    },
    release: async (command) => {
      releases++;
      if (options.releaseThrows) throw new Error('SDK timeout after command');
      return { accepted: true, authorizationId: command.authorizationId };
    },
    waitForPassage: async () => ({
      vendorEventId: 'physical-giro-1',
      occurredAt: new Date().toISOString(),
      outcome: 'CONFIRMED',
    }),
  };
  const fetchImpl = async (url, init) => {
    const op = url.split('/').pop();
    const body = JSON.parse(init.body);
    calls.push({ op, body });
    assert.equal(body.deviceId, deviceId);
    assert.equal(body.deviceToken, token);
    assert.ok(body.nonce.length >= 16);
    assert.ok(Number.isSafeInteger(body.timestamp));
    const data = op === 'identify'
      ? { allowed: options.denied !== true, authorizationId: authId, gymId: 'gym-a' }
      : op === 'claim'
        ? { command: {
          authorizationId: options.wrongAuthorization ? 'other-auth' : authId,
          deviceId, manufacturer: options.manufacturer || 'HENRY',
          direction: 'ENTRY', expiresAt: new Date(Date.now() + 15000).toISOString(),
        } }
        : op === 'ack' ? { accepted: true }
          : { confirmed: true };
    return { ok: true, json: async () => data };
  };
  const client = new IronPhysicalGatewayClient({ origin, deviceId, token, sdk, fetchImpl });
  return { client, calls, getReleases: () => releases };
}

test('local SDK gateway executes canonical authorize/claim/ack/passage sequence exactly once', async () => {
  const t = createCase();
  assert.deepEqual(await t.client.processOnce(), { handled: true, allowed: true, confirmed: true });
  assert.deepEqual(t.calls.map(x => x.op), ['identify', 'claim', 'ack', 'passage']);
  assert.equal(t.getReleases(), 1);
  const passage = t.calls.at(-1).body;
  const expected = passageSignature({
    deviceId, gymId: 'gym-a', manufacturer: 'HENRY', authorizationId: authId,
    vendorEventId: passage.vendorEventId,
    occurredAt: passage.occurredAt, outcome: 'CONFIRMED',
  }, token);
  assert.equal(passage.signature, expected);
  assert.equal(await t.client.processOnce().then(x => x.handled), false);
});

test('denied canonical decision never calls native SDK', async () => {
  const t = createCase({ denied: true });
  assert.deepEqual(await t.client.processOnce(), { handled: true, allowed: false });
  assert.equal(t.getReleases(), 0);
  assert.deepEqual(t.calls.map(x => x.op), ['identify']);
});

test('mismatched command cannot open hardware even with allowed decision', async () => {
  const t = createCase({ wrongAuthorization: true });
  assert.deepEqual(await t.client.processOnce(), { handled: true, allowed: false });
  assert.equal(t.getReleases(), 0);
  assert.deepEqual(t.calls.map(x => x.op), ['identify', 'claim']);
});

test('SDK exceptions quarantine unknown release and never retry same access', async () => {
  const t = createCase({ releaseThrows: true });
  assert.deepEqual(await t.client.processOnce(), { handled: true, allowed: false, uncertain: true });
  assert.equal(t.getReleases(), 1);
  assert.equal(t.calls.at(-1).op, 'ack');
  assert.equal(t.calls.at(-1).body.status, 'UNKNOWN');
  assert.equal(await t.client.processOnce().then(x => x.handled), false);
});

test('passage signature changes on tenant or event tampering', () => {
  const event = {
    deviceId, gymId: 'gym-a', manufacturer: 'DIMEP', authorizationId: authId,
    vendorEventId: 'giro1', occurredAt: '2026-10-30T12:00:00.000Z',
    outcome: 'CONFIRMED',
  };
  const good = passageSignature(event, token);
  assert.equal(good.length, 64);
  assert.notEqual(good, passageSignature({ ...event, gymId: 'gym-b' }, token));
  assert.notEqual(good, passageSignature({ ...event, vendorEventId: 'giro2' }, token));
});
