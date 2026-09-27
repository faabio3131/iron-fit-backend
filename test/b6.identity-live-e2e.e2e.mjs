import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { login, request } from '../scripts/b6-e2e-lib.mjs';

const require = createRequire(import.meta.url);
const {
  decryptActionSecret,
  totpCode,
} = require('../dist/src/modules/auth/auth-security.js');

const prisma = new PrismaClient();

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

async function latestPasswordReset(userId) {
  const row = await prisma.authActionToken.findFirst({
    where: { userId, kind: 'PASSWORD_RESET' },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(row?.deliveryCiphertext);
  const key = process.env.AUTH_ACTION_TOKEN_ENCRYPTION_KEY;
  assert.ok(key);
  const raw = decryptActionSecret(
    { get: (name) => name === 'AUTH_ACTION_TOKEN_ENCRYPTION_KEY' ? key : undefined },
    row.deliveryCiphertext,
  );
  return { row, raw };
}

test('B6 live refresh rotation, session revocation, password recovery and MFA', async () => {
  const suffix = randomUUID().slice(0, 8);
  const initialPassword = process.env.B6_OWNER_PASSWORD;
  const resetPassword = process.env.B6_RESET_PASSWORD;
  assert.ok(initialPassword && resetPassword);

  const email = `b6-identity-${suffix}@example.com`;
  await request('/commercial/trial/start', {
    method: 'POST',
    expected: 201,
    body: {
      requestId: randomUUID(),
      email,
      password: initialPassword,
      name: 'B6 Identity Owner',
      gymName: `B6 Identity ${suffix}`,
      timezone: 'America/Sao_Paulo',
    },
  });

  let owner = await login(email, initialPassword);

  const rotated = (await request('/auth/refresh', {
    method: 'POST',
    expected: 200,
    body: { refreshToken: owner.refresh_token },
  })).payload;
  await request('/auth/refresh', {
    method: 'POST',
    expected: 401,
    body: { refreshToken: owner.refresh_token },
  });
  await request('/auth/me', {
    token: rotated.access_token,
    expected: 401,
  });

  owner = await login(email, initialPassword);
  const secondary = await login(email, initialPassword);
  const secondarySessionId = decodePayload(secondary.access_token).sid;
  const sessions = (await request('/auth/sessions', {
    token: owner.access_token,
    expected: 200,
  })).payload;
  assert.ok(sessions.some((session) => session.id === secondarySessionId));

  await request('/auth/sessions/revoke', {
    method: 'POST',
    token: owner.access_token,
    expected: 200,
    body: {
      sessionId: secondarySessionId,
      currentPassword: initialPassword,
    },
  });
  await request('/auth/me', {
    token: secondary.access_token,
    expected: 401,
  });

  const unknown = (await request('/auth/password/reset/request', {
    method: 'POST',
    expected: 202,
    body: { email: `missing-${suffix}@example.com` },
  })).payload;
  assert.equal(unknown.accepted, true);

  await request('/auth/password/reset/request', {
    method: 'POST',
    expected: 202,
    body: { email },
  });
  let action = await latestPasswordReset(owner.user.id);
  await prisma.authActionToken.update({
    where: { id: action.row.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await request('/auth/password/reset/confirm', {
    method: 'POST',
    expected: 401,
    body: {
      token: action.raw,
      newPassword: resetPassword,
    },
  });

  await request('/auth/password/reset/request', {
    method: 'POST',
    expected: 202,
    body: { email },
  });
  action = await latestPasswordReset(owner.user.id);
  await request('/auth/password/reset/confirm', {
    method: 'POST',
    expected: 200,
    body: {
      token: action.raw,
      newPassword: resetPassword,
    },
  });
  await request('/auth/password/reset/confirm', {
    method: 'POST',
    expected: 401,
    body: {
      token: action.raw,
      newPassword: initialPassword,
    },
  });
  await request('/auth/me', {
    token: owner.access_token,
    expected: 401,
  });

  owner = await login(email, resetPassword);
  const setup = (await request('/auth/mfa/setup', {
    method: 'POST',
    token: owner.access_token,
    expected: 200,
    body: { currentPassword: resetPassword },
  })).payload;
  const firstCode = totpCode(setup.secret, new Date());
  const enabled = (await request('/auth/mfa/confirm', {
    method: 'POST',
    token: owner.access_token,
    expected: 200,
    body: { code: firstCode },
  })).payload;
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.recoveryCodes.length, 8);

  const noFactor = await login(email, resetPassword);
  assert.equal(noFactor.requires_mfa, true);
  assert.equal(noFactor.access_token, undefined);

  const withFactor = await login(email, resetPassword, {
    mfaCode: totpCode(setup.secret, new Date()),
  });
  assert.equal(typeof withFactor.access_token, 'string');

  await request('/auth/sessions/revoke-others', {
    method: 'POST',
    token: withFactor.access_token,
    expected: 401,
    body: { currentPassword: resetPassword },
  });
  await request('/auth/sessions/revoke-others', {
    method: 'POST',
    token: withFactor.access_token,
    expected: 200,
    body: {
      currentPassword: resetPassword,
      mfaCode: totpCode(setup.secret, new Date()),
    },
  });

  await request('/auth/logout', {
    method: 'POST',
    expected: 200,
    body: { refreshToken: withFactor.refresh_token },
  });
  await request('/auth/me', {
    token: withFactor.access_token,
    expected: 401,
  });
}, { timeout: 60000 });

test.after(async () => {
  await prisma.$disconnect();
});
