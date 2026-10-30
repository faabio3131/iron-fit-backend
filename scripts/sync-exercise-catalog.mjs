import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/exercises/exercise-catalog.pt-BR.v1.json'), 'utf8'));
if (data.version !== 1 || !Array.isArray(data.exercises) || data.exercises.length < 250) {
  throw new Error('Exercise catalog version/count invalid');
}
const names = new Set();
for (const row of data.exercises) {
  if (!row.name?.trim() || !row.muscleGroup?.trim() || names.has(row.name.trim().toLocaleLowerCase('pt-BR'))) {
    throw new Error('Invalid or duplicate exercise name');
  }
  names.add(row.name.trim().toLocaleLowerCase('pt-BR'));
  if (row.videoUrl !== null && !/^https:\/\/(www\.)?(youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}|youtu\.be\/[A-Za-z0-9_-]{11})$/.test(row.videoUrl)) throw new Error('Invalid YouTube candidate URL');
}
const prisma = new PrismaClient();
try {
  let created = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of data.exercises) {
      const existing = await tx.exercise.findUnique({ where: { name: row.name } });
      if (existing) continue; // preserve existing videos, contraindications and training references
      await tx.exercise.create({ data: {
        name: row.name, muscleGroup: row.muscleGroup, videoUrl: row.videoUrl,
        movement: row.movement, level: row.level,
      } });
      created++;
    }
  }, { timeout: 120000 });
  console.log(JSON.stringify({ catalog: data.exercises.length, inserted: created, existingPreserved: data.exercises.length - created }));
} finally {
  await prisma.$disconnect();
}
