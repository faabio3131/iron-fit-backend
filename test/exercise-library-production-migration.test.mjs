import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/exercises/exercise-catalog.pt-BR.v1.json'), 'utf8')).exercises;
const sql = fs.readFileSync(path.join(root, 'prisma/migrations/20261030150000_exercise_library_initial_content/migration.sql'), 'utf8');

test('production exercise library migration is complete and preserves existing exercise data', () => {
  assert.equal(catalog.length, 272);
  assert.equal(catalog.filter((row) => row.videoUrl).length, 110);
  assert.match(sql, /ON CONFLICT \("name"\) DO NOTHING;/);
  assert.doesNotMatch(sql, /\b(UPDATE|DELETE|TRUNCATE|DROP)\b/i);
  assert.equal((sql.match(/gen_random_uuid\(\)/g) ?? []).length, catalog.length);
  for (const row of catalog) {
    const escapedName = row.name.replaceAll("'", "''");
    assert.ok(sql.includes("'" + escapedName + "'"), row.name);
    if (row.videoUrl) assert.ok(sql.includes("'" + row.videoUrl + "'"), row.name);
  }
});
