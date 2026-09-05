import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tsv(file) {
  const [header, ...lines] = fs.readFileSync(path.join(root, file), 'utf8').trim().split(/\r?\n/);
  const cols = header.split('\t');
  return lines.map((line) => Object.fromEntries(line.split('\t').map((value, index) => [cols[index], value])));
}

test('EQ2 manufacturer registry is global, unique and sourced', () => {
  const manufacturers = tsv('data/equipment/manufacturers.v1.tsv');
  assert.ok(manufacturers.length >= 10);
  assert.equal(new Set(manufacturers.map((m) => m.slug)).size, manufacturers.length);
  for (const manufacturer of manufacturers) {
    assert.match(manufacturer.slug, /^[a-z0-9-]+$/);
    assert.match(manufacturer.website, /^https:\/\//);
    assert.equal(Object.hasOwn(manufacturer, 'gymId'), false);
  }
});

test('EQ2 verified commercial models map only to existing canonical capabilities', () => {
  const manufacturers = new Set(tsv('data/equipment/manufacturers.v1.tsv').map((m) => m.slug));
  const canonical = new Set(tsv('data/equipment/equipment-taxonomy.v1.tsv').map((e) => e.id));
  const models = tsv('data/equipment/equipment-model-registry.v1.tsv');
  assert.ok(models.length >= 8);
  for (const model of models) {
    assert.ok(manufacturers.has(model.manufacturer_slug), `unknown manufacturer ${model.manufacturer_slug}`);
    assert.ok(canonical.has(model.catalog_item_id), `unknown canonical item ${model.catalog_item_id}`);
    assert.match(model.source_url, /^https:\/\//);
    assert.equal(Object.hasOwn(model, 'gymId'), false);
  }
});

test('EQ2 alias vocabulary does not duplicate canonical IDs', () => {
  const rows = tsv('data/equipment/equipment-taxonomy.v1.tsv');
  const ids = new Set(rows.map((row) => row.id));
  const normalizedAliases = [];
  for (const row of rows) {
    const aliases = (row.aliases ?? '').split(';').filter(Boolean);
    for (const alias of aliases) {
      const normalized = alias.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (normalized) normalizedAliases.push([normalized, row.id]);
    }
  }
  assert.ok(normalizedAliases.length > 100);
  for (const [, id] of normalizedAliases) assert.ok(ids.has(id));
});

test('EQ2 documents capability-based equivalence and ambiguous alias fail-closed behavior', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/EQ2_MANUFACTURER_MODEL_ALIAS_EQUIVALENCE_REGISTRY.md'), 'utf8');
  assert.ok(doc.includes('same canonical capability'));
  assert.ok(doc.includes('ambiguous aliases must fail closed'));
  assert.ok(doc.includes('never carry `gymId`'));
  assert.ok(doc.includes('EQ3'));
  assert.ok(doc.includes('EQ5'));
});
