import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { FiscalA1DelegationService } = require('../dist/src/modules/financial/fiscal-a1-delegation.service.js');
const { FiscalBridgeHttpTransport } = require('../dist/src/modules/financial/fiscal-bridge.contract.js');
const { IntegrationEnvironment } = require('@prisma/client');
const baseUrl = 'https://127.0.0.1:18443/';
const origin = 'https://app.ironfitcore.com.br';
const directory = process.env.IRON_NFCORE_FIXTURE_DIR;
const token = process.env.IRON_NFCORE_WORKLOAD_TOKEN;
const password = process.env.IRON_NFCORE_PFX_PASSWORD;
const cnpjs = { a: '11222333000181', b: '12345678000195' };
const transport = new FiscalBridgeHttpTransport();

function context(suffix, workloadId = 'ci-' + suffix + '-full') {
  return {
    environment: IntegrationEnvironment.HOMOLOG,
    scope: { tenantId: 'gym-' + suffix, unitId: 'gym-unit-' + suffix },
    configuration: { baseUrl, workloadId },
    credential: { reveal: () => token },
  };
}
// Only IRON's upstream authenticated gym/profile/connection resolution is fixture
// supplied. Its compiled service, HTTP transport and all NFCore components are real.
function client(suffix, ctx = context(suffix), cnpj = cnpjs[suffix]) {
  const audits = [];
  const gymId = 'gym-' + suffix;
  const service = new FiscalA1DelegationService({
    financialProfile: { findUnique: async ({ where }) => {
      assert.equal(where.gymId, gymId); return { taxID: cnpj };
    }},
    commercialTrialProvisioning: { findFirst: async ({ where }) => {
      assert.equal(where.gymId, gymId); return { cnpj };
    }},
  }, { current: () => IntegrationEnvironment.HOMOLOG }, {
    resolveBridgeContext: async (id) => {
      assert.equal(id, gymId); return { connectionId: 'ci-bridge', context: ctx };
    },
  }, transport, { record: async (event) => { audits.push(event); } });
  return { service, gymId, audits };
}

async function upload(grant, suffix, expected, sender = origin) {
  assert.equal(grant.uploadUrl, baseUrl + 'v1/iron/a1/upload');
  const pfx = await readFile(join(directory, suffix + '.p12'));
  const res = await fetch(grant.uploadUrl, {
    method: 'POST', redirect: 'error',
    headers: { origin: sender, 'content-type': 'application/json' },
    body: JSON.stringify({ delegation_token: grant.delegationToken, pfx_base64: pfx.toString('base64'), password }),
  });
  assert.equal(res.status, expected);
  const body = await res.json();
  assert.ok(!JSON.stringify(body).includes(password));
  assert.ok(!JSON.stringify(body).includes(grant.delegationToken));
  if (expected === 200) {
    assert.equal(body.status, 'STORED');
    assert.equal(body.official_homologation, 'NOT_VERIFIED');
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
}

test('P6 real IRON transport → NFCore HTTPS → PostgreSQL binding → encrypted vault lifecycle', async () => {
  assert.equal(process.env.CI, 'true');
  assert.ok(directory && token && password);
  const a = client('a'), b = client('b');
  const actor = 'ci-owner';
  const status = (x) => x.service.status(x.gymId);
  const prepare = (x) => x.service.prepare(x.gymId, actor);
  assert.equal((await status(a)).status, 'ABSENT');
  assert.equal((await status(b)).status, 'ABSENT');

  const grantA = await prepare(a);
  await upload(grantA, 'a', 403, 'https://foreign.example');
  await upload(grantA, 'a', 200);
  await upload(grantA, 'a', 409);
  assert.equal((await status(a)).status, 'STORED');
  assert.equal((await status(b)).status, 'ABSENT');
  const grantB = await prepare(b);
  await upload(grantB, 'b', 200);
  assert.equal((await status(b)).status, 'STORED');

  const wrong = client('a', context('a'), cnpjs.b);
  await assert.rejects(() => status(wrong));
  const unauthorized = client('a', context('b', 'ci-a-full'));
  await assert.rejects(() => status(unauthorized));
  const limited = client('a', context('a','ci-a-read'));
  await assert.rejects(() => limited.service.withdraw(limited.gymId, actor, randomUUID()));
  assert.equal((await status(a)).status, 'STORED');
  assert.equal(limited.audits.length, 0);

  // Unused grant must be invalidated before withdrawal, and replay cannot
  // destroy a later replacement. B's certificate must survive A's withdrawal.
  const unused = await prepare(a);
  const requestId = randomUUID();
  assert.deepEqual(await a.service.withdraw(a.gymId, actor, requestId), {
    status: 'WITHDRAWN', officialRevocation: 'NOT_PERFORMED', officialHomologation: 'NOT_VERIFIED',
  });
  assert.equal((await status(a)).status, 'ABSENT');
  assert.equal((await status(b)).status, 'STORED');
  await upload(unused, 'a', 409);
  const mismatch = await prepare(a);
  await upload(mismatch, 'b', 422);
  assert.equal((await status(a)).status, 'ABSENT');
  await upload(mismatch, 'a', 409);
  await upload(await prepare(a), 'a', 200);
  await assert.rejects(() => a.service.withdraw(a.gymId, actor, requestId));
  assert.equal((await status(a)).status, 'STORED');
  assert.equal((await status(b)).status, 'STORED');

  const names = (await readdir(join(directory, 'vault'))).filter(x => x.endsWith('.a1.enc'));
  assert.equal(names.length, 2);
  for (const name of names) {
    const sealed = await readFile(join(directory, 'vault', name));
    assert.equal(sealed.subarray(0,5).toString('hex'), '4e46413101');
    assert.equal(sealed.includes(Buffer.from(password)), false);
  }
  assert.equal(a.audits.filter(x => x.action === 'FISCAL_A1_VAULT_WITHDRAWN').length, 1);
  assert.ok(!JSON.stringify(a.audits).includes(token));
  assert.ok(!JSON.stringify(a.audits).includes(grantA.delegationToken));
  console.log(JSON.stringify({event:'iron_nfcore_a1_cross_repo', transport:'REAL_HTTPS', vault:'REAL_AES_GCM', postgres:'REAL_DISPOSABLE', issuer:'SYNTHETIC_ONLY', officialHomologation:'NOT_VERIFIED', ironUpstreamScope:'FIXTURE'}));
});
