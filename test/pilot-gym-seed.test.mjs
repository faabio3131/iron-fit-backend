import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validatePilotConfig, provisionPilot } = require('../dist/prisma/seeds/pilot-gym-seed.js');
const config = () => ({ gym: { name: 'Synthetic pilot', slug: 'test-pilot', timezone: 'America/Sao_Paulo' }, planVersionId: 'published-id', effectiveUntil: new Date(Date.now() + 30 * 86400000).toISOString(), users: ['OWNER', 'RECEPTION', 'TRAINER'].map(role => ({ role, name: role, email: `${role.toLowerCase()}@example.invalid` })) });
const env = () => ({ IRON_RUNTIME_ENV: 'HOMOLOG', IRON_PILOT_APPLY: 'test-pilot', ...Object.fromEntries(['OWNER', 'RECEPTION', 'TRAINER'].map(role => [`IRON_PILOT_${role}_PASSWORD`, `Synthetic-${role}-A1!`])) });

test('pilot rejects production and mismatched tenant confirmation before database access', async () => {
  for (const override of [{ IRON_RUNTIME_ENV: 'PRODUCTION' }, { IRON_PILOT_APPLY: 'other' }]) {
    await assert.rejects(provisionPilot({}, config(), { ...env(), ...override }), /CONFIRMATION/);
  }
});
test('pilot validates distinct canonical roles, emails and independent strong passwords', () => {
  assert.equal(validatePilotConfig(config(), env()).users.length, 3);
  const badRole = config(); badRole.users[2].role = 'SUPER_ADMIN';
  assert.throws(() => validatePilotConfig(badRole, env()), /ROLES/);
  const badEmail = config(); badEmail.users[2].email = badEmail.users[0].email.toUpperCase();
  assert.throws(() => validatePilotConfig(badEmail, env()), /DISTINCT/);
  assert.throws(() => validatePilotConfig(config(), { ...env(), IRON_PILOT_OWNER_PASSWORD: 'admin123' }), /PASSWORD/);
  assert.throws(() => validatePilotConfig(config(), { ...env(), IRON_PILOT_TRAINER_PASSWORD: env().IRON_PILOT_OWNER_PASSWORD }), /DISTINCT/);
});
test('pilot refuses invalid term, timezone and missing password', () => {
  const expired = config(); expired.effectiveUntil = new Date(0).toISOString();
  assert.throws(() => validatePilotConfig(expired, env()), /TERM/);
  const timezone = config(); timezone.gym.timezone = 'not-a-timezone';
  assert.throws(() => validatePilotConfig(timezone, env()), /TIMEZONE/);
  assert.throws(() => validatePilotConfig(config(), { ...env(), IRON_PILOT_OWNER_PASSWORD: '' }), /PASSWORD/);
});
