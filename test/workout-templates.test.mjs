import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WORKOUT_TEMPLATES } = require('../dist/src/modules/workouts/workout-templates.js');
const { WorkoutsService } = require('../dist/src/modules/workouts/workouts.service.js');
const references = WORKOUT_TEMPLATES.flatMap(t => t.sessions.flatMap(s => s.exercises));
const names = [...new Set(references.map(e => e.name))];
const library = names.map((name, index) => ({ id: `exercise-${index}`, name }));
function fixture(withEquipment = true, exercises = library, compatibility = 'PRIMARY') {
  const db = {
    gym: { findFirst: async input => { assert.deepEqual(input.where, { id: 'gym-a', active: true }); return { id: 'gym-a' }; } },
    exercise: { findMany: async () => exercises },
    equipment: { findMany: async input => {
      assert.equal(input.where.gymId, 'gym-a'); assert.equal(input.where.active, true);
      assert.equal(input.where.operationalStatus, 'OPERATIONAL');
      assert.equal(input.where.catalogItem.active, true);
      return withEquipment ? library.map(exercise => ({ id: `equipment-${exercise.id}`, gymId: 'gym-a', catalogItem: { metadata: { exerciseMappings: [{ exerciseId: exercise.id, exerciseName: exercise.name, compatibility, priority: 1, sourceVersion: 'synthetic-template-test' }] } } })) : [];
    } },
  };
  return new WorkoutsService(db);
}
test('five templates resolve only real exercise IDs and scoped operational equipment, with human draft status', async () => {
  const templates = await fixture().templates('gym-a');
  assert.equal(templates.length, 5);
  for (const template of templates) {
    assert.equal(template.ready, true); assert.equal(template.status, 'DRAFT');
    assert.equal(template.requiresHumanReview, true); assert.equal(template.createdByAI, false);
    for (const session of template.sessions) for (const exercise of session.exercises) {
      assert.ok(library.some(row => row.id === exercise.exerciseId));
      if (exercise.equipmentId) assert.equal(exercise.equipmentId, `equipment-${exercise.exerciseId}`);
    }
  }
});
test('missing academy equipment blocks machine templates without blocking bodyweight drafts or inventing equipment', async () => {
  const templates = await fixture(false).templates('gym-a');
  assert.equal(templates.find(t => t.id === 'adaptation').ready, true);
  assert.equal(templates.find(t => t.id === 'functional').ready, true);
  for (const id of ['hypertrophy-ab', 'conditioning', 'lower-body']) {
    const template = templates.find(t => t.id === id); assert.equal(template.ready, false); assert.ok(template.missingEquipment.length);
  }
});
test('unknown library content is disclosed as missing and an unscoped caller cannot resolve templates', async () => {
  const templates = await fixture(false, []).templates('gym-a');
  assert.ok(templates.every(t => !t.ready && t.missingExercises.length > 0));
  await assert.rejects(fixture().templates(), /Tenant ativo/);
});

test('an optional accessory is never treated as proof that a required machine is available', async () => {
  const templates = await fixture(true, library, 'OPTIONAL').templates('gym-a');
  assert.equal(templates.find(t => t.id === 'hypertrophy-ab').ready, false);
  assert.equal(templates.find(t => t.id === 'lower-body').ready, false);
});
