import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');

test('F physical edge preflight requires real HTTPS URLs and expected runtime identity', async () => {
  const source = await read('scripts/public-edge-preflight.mjs');

  for (const required of [
    'IRON_PUBLIC_API_URL',
    'IRON_PUBLIC_WEB_URL',
    'IRON_EXPECTED_BUILD_SHA',
    'IRON_EXPECTED_RUNTIME_ENV',
  ]) {
    assert.match(source, new RegExp(required));
  }
  assert.match(source, /protocol !== 'https:'/);
  assert.match(source, /lookup\(url\.hostname/);
  assert.match(source, /\/api\/v1\/health\/live/);
  assert.match(source, /\/api\/v1\/health\/ready/);
  assert.match(source, /access-control-allow-origin/);
  assert.match(source, /access-control-allow-credentials/);
  assert.match(source, /tlsVerifiedByHttpsFetch: true/);
});

test('F preflight cannot silently accept DEV as a physical launch environment', async () => {
  const source = await read('scripts/public-edge-preflight.mjs');
  assert.match(source, /\['HOMOLOG', 'PROD'\]/);
  assert.match(source, /IRON_EXPECTED_RUNTIME_ENV deve ser HOMOLOG ou PROD/);
});

test('E/F readiness documentation preserves physical-gate boundaries', async () => {
  const doc = await read('docs/E_F_DATABASE_EDGE_PREFLIGHT.md');
  assert.match(doc, /não passa fisicamente/);
  assert.match(doc, /Gate F só pode receber evidência/);
  assert.match(doc, /Nenhum domínio, certificado ou URL é declarado existente/);
});
