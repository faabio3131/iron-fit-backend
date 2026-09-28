import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Macro M readiness manifest stays fail-closed without external operational evidence', async () => {
  const manifest = JSON.parse(
    await readFile(
      'docs/operations/IRON_OPERATIONS_READINESS.json',
      'utf8',
    ),
  );

  assert.equal(manifest.macro, 'M');
  assert.equal(manifest.status, 'CANDIDATE_INTERNAL');
  assert.equal(manifest.gate, 'BLOCKED_EXTERNAL');
  assert.deepEqual(
    Object.keys(manifest.workPackages).sort(),
    [
      'M1_SUPPORT',
      'M2_SEVERITIES',
      'M3_INCIDENT_RESPONSE',
      'M4_DEPLOY_ROLLBACK',
      'M5_PROVIDER_OUTAGE',
      'M6_MONITORING_ALERTS',
    ],
  );
});

test('Macro M runbook covers all six operational work packages', async () => {
  const docs = await readFile(
    'docs/operations/M_OPERATIONS_SRE_SUPPORT.md',
    'utf8',
  );

  for (const section of [
    'M1 — Support',
    'M2 — Severity model',
    'M3 — Incident response',
    'M4 — Deploy / rollback',
    'M5 — Provider outage',
    'M6 — Monitoring / alerts',
  ]) {
    assert.equal(docs.includes(section), true);
  }

  assert.equal(docs.includes('SEV0'), true);
  assert.equal(docs.includes('BLOCKED_EXTERNAL'), true);
  assert.equal(docs.toLowerCase().includes('real rollback drill'), true);
  assert.equal(docs.toLowerCase().includes('test alert delivered'), true);
});

test('existing runtime observability surfaces remain part of M6 evidence path', async () => {
  const [metrics, health] = await Promise.all([
    readFile(
      'src/common/observability/runtime-metrics.service.ts',
      'utf8',
    ),
    readFile('src/health.controller.ts', 'utf8'),
  ]);

  assert.equal(metrics.includes('requestTotal'), true);
  assert.equal(metrics.includes('error5xxTotal'), true);
  assert.equal(metrics.includes('maxDurationMs'), true);
  assert.equal(metrics.includes('rssBytes'), true);
  assert.equal(health.includes("@Get('ready')"), true);
  assert.equal(health.includes('SELECT 1'), true);
});
