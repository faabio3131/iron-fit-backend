import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
const root = path.resolve(import.meta.dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/exercises/exercise-catalog.pt-BR.v1.json'), 'utf8'));
const script = fs.readFileSync(path.join(root, 'scripts/sync-exercise-catalog.mjs'), 'utf8');
test('exercise library covers major training families without duplications or fictional video', () => {
  assert.equal(data.exercises.length, 272);
  const groups = new Set(data.exercises.map(item => item.muscleGroup));
  for (const group of ['Peito','Costas','Ombros','Quadríceps','Posteriores de coxa','Glúteos','Cardio','Funcional','Mobilidade','Alongamento','Abdômen e core']) assert.ok(groups.has(group), group);
  assert.equal(new Set(data.exercises.map(x=>x.name.toLowerCase())).size, 272);
  assert.equal(data.exercises.filter(x=>x.videoUrl !== null).length, 92);
  assert.equal(data.exercises.find(x=>x.name === 'Agachamento livre com barra')?.videoUrl, 'https://youtu.be/zgk71dUUt0Y');
});
test('sync preserves existing records, videos and contraindications', () => {
  assert.match(script,/findUnique/);
  assert.match(script,/if \(existing\) continue/);
  assert.match(script,/\$transaction/);
  assert.doesNotMatch(script,/exercise\.update\(/);
  assert.doesNotMatch(script,/deleteMany/);
});
