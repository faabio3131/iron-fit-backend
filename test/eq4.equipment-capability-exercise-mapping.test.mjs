import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mappingPath = path.join(root, 'data', 'equipment', 'exercise-equipment-capability-map.v1.tsv');
const taxonomyPath = path.join(root, 'data', 'equipment', 'equipment-taxonomy.v1.tsv');
const mappingLines = fs.readFileSync(mappingPath, 'utf8').trim().split(/\r?\n/);
const taxonomyLines = fs.readFileSync(taxonomyPath, 'utf8').trim().split(/\r?\n/);
const syncScript = fs.readFileSync(path.join(root, 'scripts', 'sync-exercise-equipment-mappings.mjs'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'src', 'common', 'equipment', 'equipment-exercise-mapping.ts'), 'utf8');
const equipmentService = fs.readFileSync(path.join(root, 'src', 'modules', 'equipments', 'equipments.service.ts'), 'utf8');
const equipmentController = fs.readFileSync(path.join(root, 'src', 'modules', 'equipments', 'equipments.controller.ts'), 'utf8');
const workoutsService = fs.readFileSync(path.join(root, 'src', 'modules', 'workouts', 'workouts.service.ts'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'docs', 'EQ4_EQUIPMENT_CAPABILITY_EXERCISE_MAPPING.md'), 'utf8');

function parseTsv(lines) {
  const [header, ...rows] = lines;
  return { header, rows: rows.map((line) => line.split('\t')) };
}

test('EQ4 registry maps exercises only to existing canonical equipment capabilities', () => {
  const mapping = parseTsv(mappingLines);
  const taxonomy = parseTsv(taxonomyLines);
  assert.equal(mapping.header, 'exercise_name\tcatalog_slug\tcompatibility\tpriority');
  assert.equal(taxonomy.header, 'id\tcategory\tname\taliases');

  const taxonomySlugs = new Set(taxonomy.rows.map(([slug]) => slug));
  const allowedCompatibility = new Set(['PRIMARY', 'ALTERNATIVE', 'OPTIONAL']);
  const seenPairs = new Set();

  assert.ok(mapping.rows.length >= 10, 'initial mapping registry should not be empty or trivial');
  for (const [exerciseName, catalogSlug, compatibility, priority] of mapping.rows) {
    assert.ok(exerciseName);
    assert.ok(taxonomySlugs.has(catalogSlug), `unknown canonical capability: ${catalogSlug}`);
    assert.ok(allowedCompatibility.has(compatibility));
    assert.ok(Number.isInteger(Number(priority)) && Number(priority) >= 0);
    const pair = `${exerciseName}::${catalogSlug}`;
    assert.equal(seenPairs.has(pair), false, `duplicate exercise/capability pair: ${pair}`);
    seenPairs.add(pair);
  }
});

test('EQ4 runtime projection is versioned, validated and global rather than tenant-authored', () => {
  assert.ok(syncScript.includes("const SOURCE_VERSION = 'v1'"));
  assert.ok(syncScript.includes('Missing canonical exercises'));
  assert.ok(syncScript.includes('Missing canonical equipment capabilities'));
  assert.ok(syncScript.includes('exerciseMappingVersion: SOURCE_VERSION'));
  assert.ok(syncScript.includes('exerciseMappings:'));
  assert.equal(/\bgymId\b/.test(syncScript), false, 'global mapping sync must never be tenant-scoped');
});

test('EQ4 mapping parser accepts only governed compatibility records', () => {
  assert.ok(helper.includes("'PRIMARY'"));
  assert.ok(helper.includes("'ALTERNATIVE'"));
  assert.ok(helper.includes("'OPTIONAL'"));
  assert.ok(helper.includes('readEquipmentExerciseMappings'));
  assert.ok(helper.includes('findEquipmentExerciseMapping'));
  assert.ok(helper.includes('COMPATIBILITIES.has'));
});

test('EQ4 compatible-equipment API derives tenant and filters to active tenant inventory', () => {
  assert.ok(equipmentController.includes("@Get('exercises/:exerciseId/compatible')"));
  assert.ok(equipmentController.includes('resolveTenantOperationGymId'));
  assert.ok(equipmentController.includes('findCompatibleForExercise(exerciseId, gymId)'));

  const marker = 'async findCompatibleForExercise';
  const start = equipmentService.indexOf(marker);
  assert.notEqual(start, -1);
  const section = equipmentService.slice(start, equipmentService.indexOf('\n  async selectCatalog', start));
  assert.ok(section.includes('gymId,'));
  assert.ok(section.includes('active: true'));
  assert.ok(section.includes('catalogItemId: { not: null }'));
  assert.ok(section.includes('findEquipmentExerciseMapping'));
});

test('EQ4 workout creation rejects known incompatible catalog equipment before mutation', () => {
  assert.ok(workoutsService.includes('compatibleCatalogByExercise'));
  assert.ok(workoutsService.includes('findEquipmentExerciseMapping'));
  assert.ok(workoutsService.includes('knownCompatibleCatalog.size > 0'));
  assert.ok(workoutsService.includes('!knownCompatibleCatalog.has(equipment.catalogItemId)'));
  assert.ok(workoutsService.includes('Equipamento incompativel com o exercicio'));
  assert.ok(workoutsService.includes("where: { id: { in: equipmentIds }, gymId, active: true }"));

  const validationIndex = workoutsService.indexOf('Equipamento incompativel com o exercicio');
  const mutationIndex = workoutsService.indexOf('this.prisma.workout.create');
  assert.ok(validationIndex > -1 && mutationIndex > validationIndex, 'compatibility must be checked before workout mutation');
});

test('EQ4 explicitly preserves legacy compatibility and does not invent multi-resource semantics', () => {
  assert.ok(workoutsService.includes('if (!equipment.catalogItemId)'));
  assert.ok(docs.includes('equipamento legado sem `catalogItemId` continua compatível'));
  assert.ok(docs.includes('um único `equipmentId`'));
  assert.ok(docs.includes('não uma lista completa de todos os acessórios físicos simultâneos'));
  assert.ok(docs.includes('Nenhuma nova migration no EQ4'));
});
