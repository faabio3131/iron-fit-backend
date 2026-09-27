import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('B6 permanent CI runs real HTTP system certification after migrations and build', async () => {
  const workflow = await readFile('.github/workflows/iron-s0-quality.yml', 'utf8');
  for (const marker of [
    'npx prisma migrate deploy',
    'npm run test:smoke',
    'npx prisma db seed',
    'node scripts/b6-bootstrap.mjs',
    'node dist/main',
    'node scripts/b6-system-e2e.mjs',
    'docker build --pull',
  ]) {
    assert.equal(workflow.includes(marker), true, `missing B6 gate: ${marker}`);
  }
});

test('B6 integrated journey covers critical commercialization and adversarial paths', async () => {
  const source = await readFile('scripts/b6-system-e2e.mjs', 'utf8');
  for (const marker of [
    '/commercial/trial/start',
    '/commercial/onboarding',
    '/students',
    '/equipments',
    '/assessments',
    '/workouts',
    '/ai/workout-candidates',
    '/schedule-slots',
    '/access/events',
    '/financial/charges',
    '/saas-billing/checkout',
    '/saas-billing/change-plan',
    '/saas-billing/admin/dunning/run',
    '/product-entitlements/tenant/current',
    '/auth/refresh',
    '/auth/password/reset/confirm',
    '/auth/mfa/setup',
    'cross_tenant_denied',
    'tampered_claim_token_denied',
    'brute_force_rate_limit',
    'billing_reconciliation_zero_mismatch',
  ]) {
    assert.equal(source.includes(marker), true, `missing integrated path ${marker}`);
  }
});

test('B6 documentation keeps external homologation boundary factual', async () => {
  const doc = await readFile('docs/B6_INTEGRATED_SYSTEM_CERTIFICATION.md', 'utf8');
  assert.match(doc, /não há uso do Supabase legado/i);
  assert.match(doc, /não declarar produção externa/i);
  assert.match(doc, /S0–S12/);
});
