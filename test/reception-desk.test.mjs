import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { normalizeCpf } = require('../dist/src/common/security/cpf.js');
const { nextMembershipBilling, ReceptionService } = require('../dist/src/modules/reception/reception.service.js');
test('CPF validates check digits, strips formatting and keeps absent values nullable', () => {
  assert.equal(normalizeCpf('529.982.247-25'), '52998224725');
  assert.equal(normalizeCpf(undefined), null);
  for (const value of ['11111111111', '52998224726', 'abcd', '123']) assert.throws(() => normalizeCpf(value), /CPF/);
});
test('membership billing clamps month ends without skipping February or crossing quarter boundary', () => {
  assert.equal(nextMembershipBilling(new Date('2027-01-31T00:00:00Z'), 1).toISOString(), '2027-02-28T00:00:00.000Z');
  assert.equal(nextMembershipBilling(new Date('2028-01-31T00:00:00Z'), 1).toISOString(), '2028-02-29T00:00:00.000Z');
  assert.equal(nextMembershipBilling(new Date('2026-11-30T00:00:00Z'), 3).toISOString(), '2027-02-28T00:00:00.000Z');
});
test('desk requires active current OWNER/RECEPTION membership and refuses global/employee privilege widening', async () => {
  const calls = [];
  const db = { userRole: { findFirst: async input => { calls.push(input); return null; } } };
  const service = new ReceptionService(db, {}, {});
  await assert.rejects(service.catalog('gym-a', 'actor'), /autorizada/);
  assert.equal(calls[0].where.gymId, 'gym-a');
  assert.deepEqual(calls[0].where.role.name.in, ['OWNER', 'RECEPTION']);
  await assert.rejects(service.catalog(undefined, 'actor'), /autenticados/);
});
test('unconfirmed receipts fail before opening a transaction or calling finance', async () => {
  const service = new ReceptionService({}, {}, {});
  await assert.rejects(service.enroll('gym-a', 'actor', { receivedConfirmed: false, paymentMethod: 'CASH' }), /recebimento/);
  await assert.rejects(service.receive('gym-a', 'actor', 'charge', { receivedConfirmed: true, paymentMethod: 'GATEWAY_SUCCESS' }), /recebimento/);
});
