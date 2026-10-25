import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Prisma } = require('@prisma/client');
const { EquipmentsService } = require('../dist/src/modules/equipments/equipments.service.js');

function setup({ active = true, failCode = null, foreign = false } = {}) {
  let changed = 0;
  let audited = 0;
  const state = { id: 'equipment-a', gymId: 'gym-a', catalogItemId: 'catalog-1', active };
  const prisma = {
    gym: { findFirst: async ({ where }) => {
      assert.deepEqual(where, { id: 'gym-a', active: true });
      return { id: 'gym-a' };
    } },
    $transaction: async (op, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return op({
        equipment: {
          findFirst: async ({ where }) => {
            assert.deepEqual(where, { gymId: 'gym-a', catalogItemId: 'catalog-1' });
            return foreign ? null : { ...state };
          },
          update: async ({ where, data }) => {
            assert.deepEqual(where, {
              id: 'equipment-a', gymId: 'gym-a', catalogItemId: 'catalog-1', active: true,
            });
            if (failCode) {
              throw new Prisma.PrismaClientKnownRequestError('race', {
                code: failCode, clientVersion: '6.19.3',
              });
            }
            changed++;
            state.active = data.active;
            return { ...state };
          },
        },
        auditLog: {
          create: async ({ data }) => {
            audited++;
            assert.equal(data.gymId, 'gym-a');
            assert.equal(data.action, 'GYM_EQUIPMENT_CATALOG_DESELECTED');
            return { id: 'audit-1' };
          },
        },
      });
    },
  };
  return { service: new EquipmentsService(prisma, {
    record: async (event, tx) => {
      assert.ok(tx);
      await tx.auditLog.create({ data: event });
    },
  }), state, counters: () => ({ changed, audited }) };
}

test('C02 deselection is tenant-scoped, conditional and audited in one transaction', async () => {
  const x = setup();
  const result = await x.service.deselectCatalog('catalog-1', 'gym-a', 'owner-a');
  assert.equal(result.active, false);
  assert.deepEqual(x.counters(), { changed: 1, audited: 1 });
});

test('C02 repeated deselection returns inactive equipment without duplicate audit', async () => {
  const x = setup({ active: false });
  const result = await x.service.deselectCatalog('catalog-1', 'gym-a', 'owner-a');
  assert.equal(result.active, false);
  assert.deepEqual(x.counters(), { changed: 0, audited: 0 });
});

test('C02 another gym item is not deselected or audited', async () => {
  const x = setup({ foreign: true });
  await assert.rejects(
    () => x.service.deselectCatalog('catalog-1', 'gym-a'),
    error => error?.getStatus?.() === 404,
  );
  assert.deepEqual(x.counters(), { changed: 0, audited: 0 });
});

test('C02 concurrent deselection conflict cannot audit a write that lost the race', async () => {
  const x = setup({ failCode: 'P2025' });
  await assert.rejects(
    () => x.service.deselectCatalog('catalog-1', 'gym-a'),
    error => error?.getStatus?.() === 400,
  );
  assert.deepEqual(x.counters(), { changed: 0, audited: 0 });
});
