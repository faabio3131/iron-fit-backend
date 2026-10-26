import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { login, request } from '../scripts/b6-e2e-lib.mjs';

const proofFile = '/tmp/iron-q-disposable-restart-proof.json';
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.IRON_RUNTIME_ENV, 'HOMOLOG');
const url = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/iron_ci',
  'Physical production and non-disposable databases are forbidden in restart drill');

const mode = process.argv[2];
if (mode === 'prepare') {
  const pass = process.env.B6_OWNER_PASSWORD;
  assert.ok(pass);
  const suffix = randomUUID().slice(0, 8);
  const email = `q-dr-owner-${suffix}@example.com`;
  const gym = (await request('/commercial/trial/start', { method: 'POST', expected: 201,
    body: { requestId: randomUUID(), email, password: pass,
      name: 'Restart QA Owner', gymName: `Restart QA Gym ${suffix}`,
      timezone: 'America/Sao_Paulo' } })).payload;
  const session = await login(email, pass);
  await request('/auth/step-up', { token: session.access_token,
    method: 'POST', expected: 200, body: { currentPassword: pass } });
  const account = (await request('/financial/accounts', {
    token: session.access_token, method: 'POST', expected: 201,
    body: { name: `CI restart account ${suffix}`, type: 'CASH', initialBalance: 0 },
  })).payload;
  await writeFile(proofFile, JSON.stringify({
    accessToken: session.access_token, gymId: gym.gymId, accountId: account.id, email,
  }), { mode: 0o600 });
  console.log(JSON.stringify({ event: 'iron_q_disposable_restart_prepared',
    canonicalGym: true, financialAccount: true, stepUp: true }));
} else if (mode === 'verify') {
  const saved = JSON.parse(await readFile(proofFile, 'utf8'));
  const profile = (await request('/auth/me', { token: saved.accessToken, expected: 200 })).payload;
  assert.equal(profile.user?.email ?? profile.email, saved.email);
  const accounts = (await request('/financial/accounts', {
    token: saved.accessToken, expected: 200,
  })).payload;
  assert.ok(accounts.some(account => account.id === saved.accountId),
    'Financial account lost after backend process restart or step-up invalidated');
  // Further canonical mutation after restart proves continuing DB write capability.
  const another = (await request('/financial/accounts', {
    token: saved.accessToken, method: 'POST', expected: 201,
    body: { name: 'CI post-restart account', type: 'CASH', initialBalance: 0 },
  })).payload;
  assert.ok(another.id);
  await unlink(proofFile);
  console.log(JSON.stringify({ event: 'iron_q_disposable_restart_verified',
    persistedOwnerSession: true, persistedStepUp: true, restoredFinancialRead: true,
    postRestartWrite: true, newAccountCreated: true, physicalDR: false }));
} else {
  throw new Error('Expected prepare or verify for disposable restart drill');
}
