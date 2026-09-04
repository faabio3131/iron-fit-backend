import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DOC = 'docs/AGG0_PROVIDER_DISCOVERY_CAPABILITY_MAP.md';

async function readDiscovery() {
  return readFile(DOC, 'utf8');
}

test('AGG0 preserves provider-neutral authorization invariants', async () => {
  const doc = await readDiscovery();

  assert.equal(doc.includes('`UNKNOWN` nunca equivale a `ELIGIBLE`'), true);
  assert.equal(doc.includes('provider member ID é identificador externo, não autorização'), true);
  assert.equal(doc.includes('provider externo nunca escreve diretamente nos domínios internos'), true);
  assert.equal(doc.includes('IA fica fora do caminho crítico de autorização da catraca'), true);
});

test('AGG0 distinguishes public evidence from partner-only and unknown capabilities', async () => {
  const doc = await readDiscovery();

  for (const status of [
    'PUBLICLY_CONFIRMED',
    'PARTNER_ACCESS_REQUIRED',
    'NOT_PUBLICLY_CONFIRMED',
    'NOT_APPLICABLE',
  ]) {
    assert.equal(doc.includes(status), true, `missing discovery status ${status}`);
  }

  for (const provider of ['Wellhub', 'TotalPass', 'ClassPass', 'Future Provider']) {
    assert.equal(doc.includes(provider), true, `missing provider ${provider}`);
  }
});

test('AGG0 keeps visit authorization and financial settlement independently reconcilable', async () => {
  const doc = await readDiscovery();

  assert.equal(doc.includes('confirmação financeira valida receita'), true);
  assert.equal(
    doc.includes('check-in externo, evento físico e settlement devem ser reconciliáveis'),
    true,
  );
  assert.equal(doc.includes('`SETTLEMENT_API`'), true);
});

test('AGG0 records external homologation gaps instead of inventing provider contracts', async () => {
  const doc = await readDiscovery();

  assert.equal(doc.includes('Gaps externos e pendências de homologação'), true);
  assert.equal(doc.includes('Elas não autorizam implementar detalhes inventados'), true);
  assert.equal(doc.includes('nenhuma migration/schema/adapter de AGG1 misturado neste bloco'), true);
});
