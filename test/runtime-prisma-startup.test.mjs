import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('src/prisma/prisma.service.ts', 'utf8');

test('Prisma boot connection is non-blocking so HTTP can bind while DB reconnects on demand', () => {
  assert.match(source, /void this\.\$connect\(\)/);
  assert.doesNotMatch(source, /maxAttempts|setTimeout|for \(let attempt/);
  assert.match(source, /Servidor seguira no ar e reconectara a cada query/);
});
