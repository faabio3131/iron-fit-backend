import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const TARGETS = ['src', 'prisma', 'test', 'scripts'];
const EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const failures = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (EXTENSIONS.has(extname(entry.name))) files.push(full);
  }
  return files;
}

for (const target of TARGETS) {
  let files = [];
  try {
    files = await walk(join(ROOT, target));
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    throw error;
  }

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const path = relative(ROOT, file).replaceAll('\\', '/');
    const lines = content.split('\n');

    if (!content.endsWith('\n')) failures.push(`${path}: missing final newline`);

    lines.forEach((line, index) => {
      if (/\s+$/.test(line) && line.length > 0) {
        failures.push(`${path}:${index + 1}: trailing whitespace`);
      }
      if (/^(<{7}|={7}|>{7})/.test(line)) {
        failures.push(`${path}:${index + 1}: unresolved merge-conflict marker`);
      }
    });
  }
}

if (failures.length > 0) {
  console.error('IRON-S0 source hygiene gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('IRON-S0 source hygiene gate passed.');
