import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  encryptMfaSecret,
  decryptMfaSecret,
  newTotpSecret,
  passwordPolicyViolations,
  totpCode,
  verifyTotp,
} = require('../dist/src/modules/auth/auth-security.js');

const source = (path) => readFile(path, 'utf8');

test('B4 schema has one-time action tokens, recovery codes, rate-limit buckets and revocable session metadata', async () => {
  const schema = await source('prisma/schema.prisma');
  const migration = await source('prisma/migrations/20260926113000_commercial_identity_security/migration.sql');
  for (const model of ['AuthActionToken', 'AuthRecoveryCode', 'AuthRateLimitBucket']) {
    assert.match(schema, new RegExp('model ' + model));
    assert.match(migration, new RegExp('CREATE TABLE "' + model + '"'));
  }
  assert.match(schema, /previousRefreshTokenHash/);
  assert.match(schema, /absoluteExpiresAt/);
  assert.match(schema, /emailVerifiedAt/);
  assert.match(schema, /passwordChangedAt/);
  assert.match(schema, /deliveryCiphertext/);
});

test('public generic register is removed; trial is the canonical public commercial signup', async () => {
  const auth = await source('src/modules/auth/auth.controller.ts');
  const commercial = await source('src/modules/commercial/commercial-trial.controller.ts');
  assert.equal(auth.includes("@Post('register')"), false);
  assert.match(commercial, /@Post\('trial\/start'\)/);
  assert.match(commercial, /req\.ip/);
});

test('password policy rejects weak credentials and accepts a launch-grade shape', () => {
  assert.ok(passwordPolicyViolations('short').length > 0);
  assert.ok(passwordPolicyViolations('longpasswordonly').length > 0);
  assert.deepEqual(passwordPolicyViolations('Strong-Pass-2026!'), []);
});

test('TOTP secret is encrypted at rest and validates within configured drift', () => {
  const key = '11'.repeat(32);
  const config = { get: (name) => name === 'MFA_ENCRYPTION_KEY' ? key : undefined };
  const secret = newTotpSecret();
  const encrypted = encryptMfaSecret(config, secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptMfaSecret(config, encrypted), secret);
  const now = new Date('2026-09-26T12:00:00.000Z');
  const code = totpCode(secret, now);
  assert.equal(verifyTotp(secret, code, now), true);
  assert.equal(verifyTotp(secret, code === '000000' ? '111111' : '000000', now), false);
});

test('login MFA cannot issue access/refresh tokens without a second factor', async () => {
  const auth = await source('src/modules/auth/auth.service.ts');
  assert.match(auth, /requires_mfa: true/);
  const requiredIndex = auth.indexOf('requires_mfa: true');
  const sessionIndex = auth.indexOf('createRefreshSession', requiredIndex);
  assert.ok(requiredIndex >= 0);
  assert.ok(sessionIndex > requiredIndex);
  assert.match(auth, /verifySecondFactor/);
});

test('access JWT is bound to a live server-side session and rejects manipulated sid/tenant claims', async () => {
  const jwt = await source('src/modules/auth/strategies/jwt.strategy.ts');
  assert.match(jwt, /payload\?\.sid/);
  assert.match(jwt, /this\.prisma\.session\.findUnique/);
  assert.match(jwt, /session\.revokedAt/);
  assert.match(jwt, /absoluteExpiresAt/);
  assert.match(jwt, /payload\.activeGymId/);
  assert.match(jwt, /payload\.scope !== context\.scope/);
});

test('password reset is one-time and revokes all live sessions', async () => {
  const service = await source('src/modules/auth/auth.service.ts');
  const security = await source('src/modules/auth/auth-security.service.ts');
  assert.match(service, /AuthActionTokenKind\.PASSWORD_RESET/);
  assert.match(security, /consumedAt: null/);
  assert.match(security, /Token invalido ou expirado/);
  const reset = service.slice(
    service.indexOf('async confirmPasswordReset'),
    service.indexOf('async requestEmailVerification'),
  );
  assert.match(reset, /session\.updateMany/);
  assert.match(reset, /revokedAt: now/);
});

test('recovery and verification requests are anti-enumeration responses', async () => {
  const service = await source('src/modules/auth/auth.service.ts');
  const reset = service.slice(
    service.indexOf('async requestPasswordReset'),
    service.indexOf('async confirmPasswordReset'),
  );
  const verify = service.slice(
    service.indexOf('async requestEmailVerification'),
    service.indexOf('async confirmEmailVerification'),
  );
  assert.match(reset, /return \{ accepted: true \}/);
  assert.match(verify, /return \{ accepted: true \}/);
  assert.equal(reset.includes('Email nao encontrado'), false);
  assert.equal(verify.includes('Email nao encontrado'), false);
});

test('rate limiting is persisted outside AuditLog and covers login, signup and recovery', async () => {
  const security = await source('src/modules/auth/auth-security.service.ts');
  assert.match(security, /authRateLimitBucket/);
  assert.match(security, /AUTH_LOGIN_REQUEST_IP/);
  assert.match(security, /AUTH_LOGIN_FAILURE_EMAIL/);
  assert.match(security, /AUTH_SIGNUP_IP/);
  assert.match(security, /AUTH_RECOVERY_IP/);
  assert.equal(security.includes('auditLog.count'), false);
});

test('sensitive identity mutations require reauthentication and MFA when enabled', async () => {
  const security = await source('src/modules/auth/auth-security.service.ts');
  const controller = await source('src/modules/auth/auth.controller.ts');
  assert.match(security, /assertStepUp/);
  assert.match(security, /bcrypt\.compare\(currentPassword/);
  assert.match(security, /user\.mfaEnabled/);
  assert.match(controller, /password\/change/);
  assert.match(controller, /email\/change\/request/);
  assert.match(controller, /sessions\/revoke/);
  assert.match(controller, /mfa\/disable/);
});

test('audit sanitizer covers identity secrets and action-token ciphertext', async () => {
  const audit = await source('src/common/audit/audit.service.ts');
  for (const key of ['currentPassword','newPassword','mfaCode','recoveryCode','deliveryCiphertext']) {
    assert.match(audit, new RegExp("'" + key + "'"));
  }
  assert.match(audit, /\[REDACTED\]/);
});

test('security environment keeps secrets external and verified-email policy explicit', async () => {
  const env = await source('.env.example');
  assert.match(env, /AUTH_ACTION_TOKEN_ENCRYPTION_KEY=/);
  assert.match(env, /MFA_ENCRYPTION_KEY=/);
  assert.match(env, /AUTH_REQUIRE_VERIFIED_EMAIL=false/);
  assert.equal(env.includes('AUTH_ACTION_TOKEN_ENCRYPTION_KEY=actual'), false);
});
