import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const taxonomyPath = path.join(root, 'data', 'equipment', 'equipment-taxonomy.v1.tsv');
const researchPath = path.join(root, 'docs', 'EQ0_MARKET_RESEARCH_EQUIPMENT_TAXONOMY.md');

function loadRows() {
  const text = fs.readFileSync(taxonomyPath, 'utf8').trim();
  const [header, ...lines] = text.split(/\r?\n/);
  assert.equal(header, 'id\tcategory\tname\taliases');
  return lines.map((line) => {
    const [id, category, name, aliases = ''] = line.split('\t');
    return { id, category, name, aliases: aliases ? aliases.split(';') : [] };
  });
}

test('EQ0 taxonomy is a broad manufacturer-neutral baseline', () => {
  const rows = loadRows();
  assert.equal(rows.length, 165);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);

  const categories = new Set(rows.map((row) => row.category));
  for (const required of [
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
    assert.ok(categories.has(required), `missing ${required}`);
  }

  const brandTokens = [
    'technogym', 'lifefitness', 'life_fitness', 'hammer_strength', 'matrix',
    'panatta', 'movement', 'precor', 'hoist', 'rogue', 'keiser', 'concept2',
  ];
  for (const row of rows) {
    assert.match(row.id, /^[a-z0-9_]+$/);
    assert.ok(row.name.length >= 3);
    const lowerId = row.id.toLowerCase();
    assert.equal(brandTokens.some((token) => lowerId.includes(token)), false,
      `canonical id must not encode manufacturer: ${row.id}`);
  }
});

test('EQ0 covers modern cardio, strength and functional capabilities', () => {
  const ids = new Set(loadRows().map((row) => row.id));
  for (const id of [
    'treadmill_slat_belt',
    'treadmill_curved_manual',
    'row_ergometer',
    'ski_ergometer',
    'bike_ergometer',
    'pl_hack_squat',
    'pl_pendulum_squat',
    'pl_belt_squat',
    'pl_hip_thrust',
    'cable_dual_adjustable_pulley',
    'smith_machine',
    'rack_power',
    'sled_push_pull',
    'pilates_reformer',
    'pneumatic_strength_machine',
  ]) {
    assert.ok(ids.has(id), `missing canonical capability ${id}`);
  }
});

test('EQ0 research records governance, standards and downstream separation', () => {
  const research = fs.readFileSync(researchPath, 'utf8');
  for (const requiredText of [
    'ISO 20957-1:2024',
    'ISO 20957-2:2024',
    'Life Fitness / Hammer Strength',
    'Panatta',
    'Movement Fitness Brasil',
    'Concept2',
    'Gym possession/availability is tenant-scoped',
    'EQ2',
    'EQ3',
    'EQ4',
    'EQ5',
  ]) {
    assert.ok(research.includes(requiredText), `missing research invariant: ${requiredText}`);
  }
});
