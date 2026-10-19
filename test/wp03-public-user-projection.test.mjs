import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const projection = readFileSync('src/common/security/public-user-select.ts','utf8');
const services = [
  'students/students.service.ts',
  'assessments/assessments.service.ts',
  'workouts/workouts.service.ts',
  'schedules/schedules.service.ts',
  'financial/financial.service.ts',
  'dashboard/dashboard.service.ts',
];
test('WP03 canonical public user projection never returns passwords, MFA, or session material', () => {
  assert.match(projection, /name: true/);
  assert.match(projection, /email: true/);
  for (const secret of ['passwordHash','mfaSecret','mfaRecoveryCodes','refreshTokenHash','apiKey']) {
    assert.doesNotMatch(projection, new RegExp(secret+'\\s*:\\s*true'));
  }
  for (const service of services) {
    const src=readFileSync('src/modules/'+service,'utf8');
    assert.match(src,/publicUserSelect/);
    assert.doesNotMatch(src,/include:\s*\{\s*user:\s*true\s*\}/);
  }
});
test('WP03 dashboard requires a tenant, never queries an unrestricted cross-tenant aggregate',()=>{
  const source=readFileSync('src/modules/dashboard/dashboard.service.ts','utf8');
  assert.match(source,/if \(!userGymId\) throw new ForbiddenException/);
  assert.doesNotMatch(source,/return userGymId \? \{ gymId: userGymId \} : \{\}/);
});