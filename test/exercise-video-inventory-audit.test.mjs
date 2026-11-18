import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { summarizeExerciseVideoInventory } from '../scripts/audit-exercise-video-inventory.mjs';

const root = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(fs.readFileSync(
  path.join(root, 'data/exercises/exercise-catalog.pt-BR.v1.json'), 'utf8'));
const queue = JSON.parse(fs.readFileSync(
  path.join(root, 'data/exercises/youtube-curation-queue.pt-BR.v1.json'), 'utf8'));

test('real video source is reconciled without presenting candidates as verified playback', () => {
  const report = summarizeExerciseVideoInventory(catalog, queue, []);
  assert.equal(report.source.catalogExercises, 272);
  assert.equal(report.source.directVideoCandidates, 110);
  assert.equal(report.source.searchOnly, 162);
  assert.equal(report.source.pendingHumanReview, 272);
  assert.equal(report.source.approvedInQueueNotIndependentlyVerified, 0);
  assert.equal(report.classification, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(report.postgres.canonicalRowsMissing, 272);
  assert.equal(report.postgres.canonicalRowsFound, 0);
  assert.doesNotMatch(JSON.stringify(report), /youtu\.be|youtube\.com|\.pfx|secretReference/);
});

test('PostgreSQL readback distinguishes catalog videos, absent rows and custom exercises', () => {
  const rows = [
    { name: 'Supino reto com barra', videoUrl: 'https://youtu.be/EZMYCLKuGow' },
    { name: 'Supino reto com halteres', videoUrl: null },
    { name: 'Supino máquina horizontal', videoUrl: 'https://youtube.com/watch?v=12345678901' },
    { name: 'Academia customizada', videoUrl: 'https://example.org/video' },
  ];
  const report = summarizeExerciseVideoInventory(catalog, queue, rows);
  assert.equal(report.postgres.totalExercises, 4);
  assert.equal(report.postgres.canonicalRowsFound, 3);
  assert.equal(report.postgres.canonicalRowsMissing, 269);
  assert.equal(report.postgres.canonicalRowsWithVideo, 2);
  assert.equal(report.postgres.matchingCandidateUrl, 1);
  assert.equal(report.postgres.differingFromCandidateUrl, 1);
  assert.equal(report.postgres.sourceCandidateAbsentInDb, 1);
  assert.equal(report.postgres.customRows, 1);
  assert.equal(report.postgres.customRowsWithVideo, 1);
  assert.equal(report.classification, 'HUMAN_REVIEW_REQUIRED');
});

test('rejects mismatched curation, duplicate records and broken source manifests', () => {
  const sampleCatalog = {
    version: 1, exercises: [{ name: 'Teste', videoUrl: 'https://youtu.be/abcdefghijk' }],
  };
  const sampleQueue = {
    version: 1, items: [{
      exerciseName: 'Teste', status: 'PENDING_HUMAN_REVIEW',
      source: 'DIRECT_CANDIDATE', directVideoUrl: 'https://youtu.be/abcdefghijk',
    }],
  };
  assert.equal(summarizeExerciseVideoInventory(sampleCatalog, sampleQueue, []).source.pendingHumanReview, 1);
  assert.throws(() => summarizeExerciseVideoInventory(sampleCatalog, {
    ...sampleQueue, items: [{ ...sampleQueue.items[0], directVideoUrl: null }],
  }, []), /INVALID_CURATION/);
  assert.throws(() => summarizeExerciseVideoInventory(sampleCatalog, sampleQueue, [
    { name: 'Teste', videoUrl: null }, { name: ' TESTE ', videoUrl: null },
  ]), /INVALID_DB_READBACK/);
  assert.throws(() => summarizeExerciseVideoInventory(sampleCatalog, {
    ...sampleQueue, items: [],
  }, []), /INCOMPLETE_CURATION/);
});

test('operator CLI performs only read-only select and masks Prisma failure details', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/audit-exercise-video-inventory.mjs'), 'utf8');
  assert.match(script, /prisma\.exercise\.findMany\(/);
  assert.match(script, /select: \{ name: true, videoUrl: true \}/);
  assert.doesNotMatch(script, /prisma\.exercise\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/);
  assert.doesNotMatch(script, /prisma\.\$executeRaw|prisma\.\$queryRaw/);
  assert.match(script, /EXERCISE_VIDEO_AUDIT_FAILED/);
  assert.doesNotMatch(script, /console\.error\(error\)|JSON\.stringify\(error\)/);
});
