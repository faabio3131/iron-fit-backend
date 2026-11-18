import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.resolve(scriptDir, '../data/exercises/exercise-catalog.pt-BR.v1.json');
const queuePath = path.resolve(scriptDir, '../data/exercises/youtube-curation-queue.pt-BR.v1.json');

const normalizedName = (value) =>
  typeof value === 'string' ? value.trim().toLocaleLowerCase('pt-BR') : '';

/**
 * Pure, deterministic, read-only comparison. Source URLs are candidates, not
 * professional approvals. Do not publish per-row URLs or personal data.
 */
export function summarizeExerciseVideoInventory(catalog, queue, dbRows) {
  if (catalog?.version !== 1 || queue?.version !== 1 ||
      !Array.isArray(catalog.exercises) || !Array.isArray(queue.items) ||
      !Array.isArray(dbRows)) {
    throw new Error('EXERCISE_AUDIT_INVALID_INPUT');
  }

  const canonical = new Map();
  for (const entry of catalog.exercises) {
    const name = normalizedName(entry.name);
    if (!name || canonical.has(name)) throw new Error('EXERCISE_AUDIT_INVALID_CATALOG');
    canonical.set(name, entry);
  }
  const reviews = new Map();
  for (const entry of queue.items) {
    const name = normalizedName(entry.exerciseName);
    if (!name || reviews.has(name) || !canonical.has(name) ||
        !['DIRECT_CANDIDATE', 'SEARCH_ONLY'].includes(entry.source) ||
        !['PENDING_HUMAN_REVIEW', 'APPROVED', 'REJECTED'].includes(entry.status) ||
        (entry.directVideoUrl ?? null) !== (canonical.get(name).videoUrl ?? null)) {
      throw new Error('EXERCISE_AUDIT_INVALID_CURATION');
    }
    reviews.set(name, entry);
  }
  if (canonical.size !== reviews.size) throw new Error('EXERCISE_AUDIT_INCOMPLETE_CURATION');

  const persisted = new Map();
  let customRows = 0;
  let customRowsWithVideo = 0;
  for (const row of dbRows) {
    const name = normalizedName(row.name);
    if (!name || persisted.has(name)) throw new Error('EXERCISE_AUDIT_INVALID_DB_READBACK');
    persisted.set(name, row);
    if (!canonical.has(name)) {
      customRows++;
      if (row.videoUrl) customRowsWithVideo++;
    }
  }

  let pendingReview = 0;
  let approvedInQueue = 0;
  let rejectedInQueue = 0;
  let directCandidates = 0;
  let searchOnly = 0;
  let canonicalRowsFound = 0;
  let canonicalRowsWithVideo = 0;
  let matchingCandidateUrl = 0;
  let differingFromCandidateUrl = 0;
  let sourceCandidateAbsentInDb = 0;
  for (const [name, item] of reviews) {
    if (item.status === 'PENDING_HUMAN_REVIEW') pendingReview++;
    if (item.status === 'APPROVED') approvedInQueue++;
    if (item.status === 'REJECTED') rejectedInQueue++;
    if (item.source === 'DIRECT_CANDIDATE') directCandidates++;
    if (item.source === 'SEARCH_ONLY') searchOnly++;

    const row = persisted.get(name);
    if (!row) continue;
    canonicalRowsFound++;
    if (row.videoUrl) {
      canonicalRowsWithVideo++;
      if (row.videoUrl === item.directVideoUrl) matchingCandidateUrl++;
      else differingFromCandidateUrl++;
    } else if (item.directVideoUrl) {
      sourceCandidateAbsentInDb++;
    }
  }

  return {
    classification: pendingReview > 0 ? 'HUMAN_REVIEW_REQUIRED' : 'CURATION_RECORDS_PRESENT_NOT_HOMOLOGATED',
    source: {
      catalogExercises: canonical.size,
      directVideoCandidates: directCandidates,
      searchOnly,
      pendingHumanReview: pendingReview,
      approvedInQueueNotIndependentlyVerified: approvedInQueue,
      rejectedInQueue,
    },
    postgres: {
      totalExercises: persisted.size,
      canonicalRowsFound,
      canonicalRowsMissing: canonical.size - canonicalRowsFound,
      canonicalRowsWithVideo,
      matchingCandidateUrl,
      differingFromCandidateUrl,
      sourceCandidateAbsentInDb,
      customRows,
      customRowsWithVideo,
    },
    proofLimits: [
      'Database URL presence does not certify playback, exercise technique, source rights or availability.',
      'Queue status is provenance metadata, never independent evidence of professional approval.',
      'No videos, contraindications, exercise mappings or tenant records were changed.',
    ],
  };
}

export async function runReadOnlyVideoInventoryAudit() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  // Load Prisma only when invoked as a CLI, so pure tests require no DB.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.exercise.findMany({
      select: { name: true, videoUrl: true },
    });
    return summarizeExerciseVideoInventory(catalog, queue, rows);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReadOnlyVideoInventoryAudit().then((result) => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }).catch((error) => {
    // Never serialize the Prisma exception; connection errors may include secrets.
    process.stderr.write('EXERCISE_VIDEO_AUDIT_FAILED ' +
      (typeof error?.code === 'string' && /^P[0-9]{4}$/.test(error.code) ? error.code : 'UNAVAILABLE') + '\n');
    process.exitCode = 1;
  });
}
