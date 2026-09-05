import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EquipmentCatalogCategory, PrismaClient } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const taxonomyPath = path.join(root, 'data', 'equipment', 'equipment-taxonomy.v1.tsv');
const prisma = new PrismaClient();

function parseTaxonomy() {
  const lines = fs.readFileSync(taxonomyPath, 'utf8').trim().split(/\r?\n/);
  const header = lines.shift();
  if (header !== 'id\tcategory\tname\taliases') {
    throw new Error('Unexpected equipment taxonomy header');
  }

  const allowedCategories = new Set(Object.values(EquipmentCatalogCategory));
  return lines.map((line, index) => {
    const [slug, category, name, aliasText = ''] = line.split('\t');
    if (!slug || !name || !allowedCategories.has(category)) {
      throw new Error(`Invalid equipment taxonomy row ${index + 2}`);
    }

    return {
      slug,
      category,
      name,
      aliases: aliasText
        .split(';')
        .map((alias) => alias.trim())
        .filter(Boolean),
    };
  });
}

async function main() {
  const items = parseTaxonomy();

  for (const item of items) {
    await prisma.equipmentCatalogItem.upsert({
      where: { slug: item.slug },
      update: {
        name: item.name,
        category: item.category,
        aliases: item.aliases,
        active: true,
      },
      create: {
        slug: item.slug,
        name: item.name,
        category: item.category,
        aliases: item.aliases,
        active: true,
      },
    });
  }

  console.log(`IRON equipment catalog synchronized: ${items.length} canonical items.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
