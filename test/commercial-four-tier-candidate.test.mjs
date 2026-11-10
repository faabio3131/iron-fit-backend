import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const candidate = JSON.parse(readFileSync(
  new URL('../config/commercial/iron-four-tiers-2026.candidate.json', import.meta.url),
  'utf8',
));

test('four-tier pricing remains an unpublished candidate, never a live entitlement source', () => {
  assert.equal(candidate.status, 'CANDIDATE_NOT_PUBLISHED');
  assert.equal(candidate.effectiveDate, null);
  assert.equal(candidate.billing.hasOfficialOfferIds, false);
  assert.equal(candidate.billing.settlementAuthority, 'FM_COMMAND_V1');
  assert.equal(candidate.features.noUnlimitedClaims, true);
});

test('candidate has four unique tiers with eight immutable commercial price identities', () => {
  assert.equal(candidate.tiers.length, 4);
  const canonical = new Set();
  const commercial = new Set();
  for (const tier of candidate.tiers) {
    assert.match(tier.code, /^IRON_[A-Z_]+$/);
    assert.equal(canonical.has(tier.code), false);
    canonical.add(tier.code);
    for (const key of ['commercialMonthlyCode', 'commercialYearlyCode']) {
      assert.match(tier[key], /^[A-Z][A-Z0-9_]+$/);
      assert.equal(commercial.has(tier[key]), false);
      commercial.add(tier[key]);
    }
    assert.ok(Number.isSafeInteger(tier.studentsMax) && tier.studentsMax > 0);
    assert.ok(Number.isSafeInteger(tier.workoutAiMonthlyMax) && tier.workoutAiMonthlyMax > 0);
    assert.ok(Number.isSafeInteger(tier.unitsMax) && tier.unitsMax > 0);
    assert.ok(Number.isSafeInteger(tier.monthlyBRLMinor) && tier.monthlyBRLMinor > 0);
    assert.ok(Number.isSafeInteger(tier.annualBRLMinor) && tier.annualBRLMinor > 0);
    assert.ok(tier.annualBRLMinor < tier.monthlyBRLMinor * 12);
  }
  assert.equal(commercial.size, 8);
});

test('candidate does not silently promise uncapped AI or unhomologated providers', () => {
  assert.ok(candidate.features.manualReviewWorkoutAI);
  assert.ok(candidate.features.noClaimUntilHomologated.includes('nfse_live'));
  assert.ok(candidate.features.noClaimUntilHomologated.includes('wellhub'));
  assert.ok(candidate.features.noClaimUntilHomologated.includes('totalpass'));
  assert.ok(candidate.trial.days > 0 && candidate.trial.studentsMax > 0);
});
