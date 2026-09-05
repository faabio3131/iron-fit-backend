import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mappingPath = path.join(root, 'data', 'equipment', 'exercise-equipment-capability-map.v1.tsv');
const prisma = new PrismaClient();
const SOURCE_VERSION = 'v1';
const COMPATIBILITIES = new Set(['PRIMARY', 'ALTERNATIVE', 'OPTIONAL']);

function parseMappings() {
  const lines = fs.readFileSync(mappingPath, 'utf8').trim().split(/\r?\n/);
  const header = lines.shift();
  if (header !== 'exercise_name\tcatalog_slug\tcompatibility\tpriority') {
    throw new Error('Unexpected exercise equipment mapping header');
  }

  return lines.map((line, index) => {
    const [exerciseName, catalogSlug, compatibility, rawPriority] = line.split('\t');
    const priority = Number(rawPriority);
    if (
      !exerciseName ||
      !catalogSlug ||
      !COMPATIBILITIES.has(compatibility) ||
      !Number.isInteger(priority) ||
      priority < 0
    ) {
      throw new Error(`Invalid exercise equipment mapping row ${index + 2}`);
    }

    return { exerciseName, catalogSlug, compatibility, priority };
  });
}

function metadataObject(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {};
}

async function main() {
  const mappings = parseMappings();
  const exerciseNames = [...new Set(mappings.map((mapping) => mapping.exerciseName))];
  const catalogSlugs = [...new Set(mappings.map((mapping) => mapping.catalogSlug))];

  const [exercises, catalogItems] = await Promise.all([
    prisma.exercise.findMany({
      where: { name: { in: exerciseNames } },
      select: { id: true, name: true },
    }),
    prisma.equipmentCatalogItem.findMany({
      where: { active: true },
      select: { id: true, slug: true, metadata: true },
    }),
  ]);

  if (exercises.length !== exerciseNames.length) {
    const found = new Set(exercises.map((exercise) => exercise.name));
    const missing = exerciseNames.filter((name) => !found.has(name));
    throw new Error(`Missing canonical exercises: ${missing.join(', ')}`);
  }

  const catalogBySlug = new Map(catalogItems.map((item) => [item.slug, item]));
  const missingCatalog = catalogSlugs.filter((slug) => !catalogBySlug.has(slug));
  if (missingCatalog.length > 0) {
    throw new Error(`Missing canonical equipment capabilities: ${missingCatalog.join(', ')}`);
  }

  const exerciseByName = new Map(exercises.map((exercise) => [exercise.name, exercise]));
  const grouped = new Map();
  for (const mapping of mappings) {
    const exercise = exerciseByName.get(mapping.exerciseName);
    const list = grouped.get(mapping.catalogSlug) ?? [];
    list.push({
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      compatibility: mapping.compatibility,
      priority: mapping.priority,
      sourceVersion: SOURCE_VERSION,
    });
    grouped.set(mapping.catalogSlug, list);
  }

  await prisma.$transaction(
    catalogItems.map((item) =>
      prisma.equipmentCatalogItem.update({
        where: { id: item.id },
        data: {
          metadata: {
            ...metadataObject(item.metadata),
            exerciseMappingVersion: SOURCE_VERSION,
            exerciseMappings: (grouped.get(item.slug) ?? [])
              .sort((left, right) => left.priority - right.priority),
          },
        },
      }),
    ),
  );

  console.log(
    `IRON exercise-equipment mappings synchronized: ${mappings.length} mappings across ${exerciseNames.length} exercises.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
