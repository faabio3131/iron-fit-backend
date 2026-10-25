import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AuthSecurityService } = require('../dist/src/modules/auth/auth-security.service.js');
const {
  encryptMfaSecret,
  hashOpaqueToken,
  newTotpSecret,
  totpCode,
} = require('../dist/src/modules/auth/auth-security.js');

function enrollmentFixture() {
  const key = '12'.repeat(32);
  const config = { get: (name) => name === 'MFA_ENCRYPTION_KEY' ? key : undefined };
  const secret = newTotpSecret();
  const encrypted = encryptMfaSecret(config, secret);
  const code = totpCode(secret);
  let claimed = false;
  let codeDeletes = 0;
  let createdCodes = null;
  let revocations = 0;
  let audits = 0;
  let currentSecret = encrypted;

  const tx = {
    user: {
      updateMany: async ({ where, data }) => {
        assert.deepEqual(where, { id: 'user-1', mfaEnabled: false, mfaSecret: encrypted });
        assert.deepEqual(data, { mfaEnabled: true });
        if (claimed || currentSecret !== where.mfaSecret) return { count: 0 };
        claimed = true;
        return { count: 1 };
      },
    },
    authRecoveryCode: {
      deleteMany: async ({ where }) => {
        assert.deepEqual(where, { userId: 'user-1' });
        codeDeletes += 1;
        return { count: 0 };
      },
      createMany: async ({ data }) => {
        createdCodes = data;
        return { count: data.length };
      },
    },
    session: {
      updateMany: async ({ where }) => {
        assert.deepEqual(where, { userId: 'user-1', revokedAt: null });
        revocations += 1;
        return { count: 1 };
      },
    },
  };
  const prisma = {
    // Both callers may read the same unconfirmed enrollment before either writes.
    user: { findUnique: async () => ({
      id: 'user-1', mfaEnabled: false, mfaSecret: encrypted,
    }) },
    $transaction: async (operation) => operation(tx),
  };
  const service = new AuthSecurityService(prisma, config, {
    record: async () => { audits += 1; },
  });

  return {
    service, code,
    get state() { return { claimed, codeDeletes, createdCodes, revocations, audits }; },
    replaceEnrollment() { currentSecret = encryptMfaSecret(config, newTotpSecret()); },
  };
}

test('C01 concurrent MFA confirmations issue exactly one usable recovery-code set', async () => {
  const fixture = enrollmentFixture();
  const results = await Promise.allSettled([
    fixture.service.confirmMfaEnrollment('user-1', fixture.code),
    fixture.service.confirmMfaEnrollment('user-1', fixture.code),
  ]);
  const successful = results.filter((result) => result.status === 'fulfilled');
  const denied = results.filter((result) => result.status === 'rejected');
  assert.equal(successful.length, 1);
  assert.equal(denied.length, 1);
  assert.equal(denied[0].reason?.getStatus?.(), 409);

  const { claimed, codeDeletes, createdCodes, revocations, audits } = fixture.state;
  assert.equal(claimed, true);
  assert.equal(codeDeletes, 1);
  assert.equal(createdCodes.length, 8);
  assert.equal(revocations, 1);
  assert.equal(audits, 1);
  const returnedCodes = successful[0].value.recoveryCodes;
  assert.equal(successful[0].value.enabled, true);
  assert.deepEqual(createdCodes.map((row) => row.codeHash),
    returnedCodes.map((raw) => hashOpaqueToken(raw)));
});

test('C01 stale MFA confirmation cannot overwrite a newer enrollment', async () => {
  const fixture = enrollmentFixture();
  fixture.replaceEnrollment();
  await assert.rejects(
    () => fixture.service.confirmMfaEnrollment('user-1', fixture.code),
    (error) => error?.getStatus?.() === 409,
  );
  assert.equal(fixture.state.codeDeletes, 0);
  assert.equal(fixture.state.createdCodes, null);
  assert.equal(fixture.state.revocations, 0);
  assert.equal(fixture.state.audits, 0);
});
