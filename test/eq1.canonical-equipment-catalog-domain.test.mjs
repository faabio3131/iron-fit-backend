import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'prisma', 'migrations', '20260904234500_canonical_equipment_catalog_domain', 'migration.sql'),
  'utf8',
);
const taxonomy = fs.readFileSync(path.join(root, 'data', 'equipment', 'equipment-taxonomy.v1.tsv'), 'utf8').trim().split(/\r?\n/);

test('EQ1 creates a global canonical catalog separated from gym inventory', () => {
  const block = schema.match(/model EquipmentCatalogItem \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(block.includes('slug               String                   @unique'));
  assert.ok(block.includes('category           EquipmentCatalogCategory'));
  assert.ok(block.includes('gymEquipments      Equipment[]'));
  assert.equal(/\bgymId\b/.test(block), false, 'global catalog must not be tenant-owned');
});

test('EQ1 preserves tenant Equipment and links it additively to catalog', () => {
  const block = schema.match(/model Equipment \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(block.includes('gymId         String'));
  assert.ok(block.includes('catalogItemId String?'));
  assert.ok(block.includes('catalogItem   EquipmentCatalogItem?'));
  assert.ok(block.includes('@@unique([gymId, catalogItemId])'));
  assert.ok(block.includes('workoutExercises WorkoutExercise[]'));
});

test('EQ1 migration is explicit, additive and protects catalog identity', () => {
  assert.ok(migration.includes('CREATE TABLE "EquipmentCatalogItem"'));
  assert.ok(migration.includes('ALTER TABLE "Equipment"\n  ADD COLUMN "catalogItemId" TEXT'));
  assert.ok(migration.includes('Equipment_gymId_catalogItemId_key'));
  assert.ok(migration.includes('ON DELETE SET NULL'));
  assert.equal(/DROP TABLE\s+"Equipment"/i.test(migration), false);
  assert.equal(/DELETE FROM\s+"Equipment"/i.test(migration), false);
});

test('EQ1 enum covers all EQ0 taxonomy families and dataset remains intact', () => {
  assert.equal(taxonomy.length - 1, 165);
  for (const category of [
    'CARDIO',
    'SELECTORIZED_STRENGTH',
    'PLATE_LOADED',
    'CABLE_FUNCTIONAL',
    'RACKS_BENCHES',
    'FREE_WEIGHTS',
    'FUNCTIONAL_CONDITIONING',
    'PILATES_REHAB',
    'SPECIALIZED_STRENGTH',
  ]) {
    assert.ok(schema.includes(category), `missing enum category ${category}`);
  }
});
