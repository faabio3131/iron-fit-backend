import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PhysicalDeviceAdminService } = require('../dist/src/modules/access/hardware/physical-device-admin.service.js');
const { PhysicalAccessDriverRegistry } = require('../dist/src/modules/access/hardware/physical-access-driver.js');

function make({ active = false, tokenHash = null, manufacturer = 'CONTROL_ID' } = {}) {
  const calls = [];
  const device = {
    id: 'd-a', gymId: 'gym-a', active, manufacturer,
    model: 'iDBlock', deviceTokenHash: tokenHash, type: 'QR_CODE',
  };
  const prisma = {
    accessDevice: {
      create: async ({ data }) => { calls.push(['create', data]); return { id: 'new-d', ...data }; },
      findFirst: async ({ where }) => where.gymId === 'gym-a' ? device : null,
      updateMany: async ({ where, data }) => { calls.push(['update', where, data]); return { count: 1 }; },
    },
    auditLog: {
      create: async ({ data }) => { calls.push(['audit', data.action]); return { id: 'a' }; },
    },
  };
  const registry = new PhysicalAccessDriverRegistry();
  return { service: new PhysicalDeviceAdminService(prisma, registry), registry, calls };
}

test('new device enrolls inactive with no network credential and tenant scope', async () => {
  const h = make();
  const result = await h.service.register('gym-a', 'owner-a', {
    name: ' Entrada ', model: 'iDBlock', manufacturer: 'CONTROL_ID', type: 'QR_CODE',
  });
  assert.equal(result.active, false);
  assert.equal(h.calls[0][1].gymId, 'gym-a');
  assert.equal(h.calls[0][1].deviceTokenHash, null);
  assert.equal(h.calls[0][1].name, 'Entrada');
  assert.equal(h.calls[1][0], 'audit');
});

test('device activation remains blocked without provisioned device token', async () => {
  const h = make();
  await assert.rejects(() => h.service.setActive('gym-a', 'owner-a', 'd-a', true), /nao provisionado/);
  assert.equal(h.calls.filter(x => x[0] === 'update').length, 0);
});

test('device activation remains blocked without installed protocol driver', async () => {
  const h = make({ tokenHash: 'sha256-token' });
  await assert.rejects(() => h.service.setActive('gym-a', 'owner-a', 'd-a', true), /driver nao homologado/);
  assert.equal(h.calls.filter(x => x[0] === 'update').length, 0);
});

test('device activation requires real registered driver and scoped write', async () => {
  const h = make({ tokenHash: 'sha256-token' });
  h.registry.register({ manufacturer: 'CONTROL_ID', transport: 'REST', supportsDevice: () => true, release: async () => null, verifyPassage: async () => false });
  const res = await h.service.setActive('gym-a', 'owner-a', 'd-a', true);
  assert.equal(res.active, true);
  assert.equal(h.calls[0][1].gymId, 'gym-a');
  assert.equal(h.calls[0][1].active, false);
  assert.equal(h.calls[1][1], 'ACCESS_DEVICE_ACTIVATED');
});

test('foreign tenant cannot update another academy hardware', async () => {
  const h = make({ tokenHash: 'hash' });
  await assert.rejects(() => h.service.setActive('gym-b', 'owner-b', 'd-a', false), /nao encontrado/);
  assert.equal(h.calls.filter(x => x[0] === 'update').length, 0);
});

test('deactivation can be performed independently of vendor SDK availability', async () => {
  const h = make({ active: true });
  const res = await h.service.setActive('gym-a', 'owner-a', 'd-a', false);
  assert.equal(res.active, false);
  assert.equal(h.calls[0][1].gymId, 'gym-a');
});

test('unsupported model cannot be activated even if a brand driver exists', async () => {
  const h = make({ tokenHash: 'sha256-token' });
  h.registry.register({
    manufacturer: 'CONTROL_ID', transport: 'REST',
    supportsDevice: () => false,
    release: async () => null,
    verifyPassage: async () => false,
  });
  await assert.rejects(() => h.service.setActive('gym-a', 'owner-a', 'd-a', true), /nao homologado/);
  assert.equal(h.calls.filter(x => x[0] === 'update').length, 0);
});
