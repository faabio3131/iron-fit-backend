import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { FiscalA1DelegationService } = require(
  '../dist/src/modules/financial/fiscal-a1-delegation.service.js',
);
const { IntegrationEnvironment } = require('@prisma/client');

const CNPJ = '11222333000181';
const TOKEN = 'A'.repeat(64);

function fixture({
  environment = IntegrationEnvironment.HOMOLOG,
  financialTaxID = CNPJ,
  trialCnpj = CNPJ,
  bridgeMissing = false,
  response = null,
} = {}) {
  const calls = [], audits = [];
  const connection = {
    connectionId: 'existing-global-bridge',
    context: {
      environment: IntegrationEnvironment.HOMOLOG,
      scope: { tenantId: 'nfcore-tenant', unitId: 'nfcore-unit' },
      configuration: { baseUrl: 'https://nfcore.example/', workloadId: 'iron-workload' },
      credential: { reveal: () => 'NEVER_SERIALIZE' },
    },
  };
  const prisma = {
    financialProfile: { findUnique: async (x) => {
      calls.push({ kind: 'profile', where: x.where });
      return financialTaxID === null ? null : { taxID: financialTaxID };
    }},
    commercialTrialProvisioning: { findFirst: async (x) => {
      calls.push({ kind: 'trial', where: x.where });
      return trialCnpj === null ? null : { cnpj: trialCnpj };
    }},
  };
  const dispatch = { resolveBridgeContext: async (gymId) => {
    calls.push({ kind: 'resolve', gymId });
    if (bridgeMissing) throw new Error('secret=NEVER_SERIALIZE');
    return connection;
  }};
  const http = { post: async (path, body, ctx, corr) => {
    calls.push({ kind: 'post', path, body, ctx, corr });
    return response ?? (path.endsWith('/status') ? {
      status: 'STORED', expires_at: new Date(Date.now()+86_400_000).toISOString(),
      official_homologation: 'NOT_VERIFIED',
    } : {
      status: 'PENDING_UPLOAD',
      delegation_token: TOKEN,
      expires_at: new Date(Date.now()+120_000).toISOString(),
      upload_path: '/v1/iron/a1/upload',
    });
  }};
  const audit = { record: async (x) => { audits.push(x); }};
  const service = new FiscalA1DelegationService(
    prisma, { current: () => environment }, dispatch, http, audit,
  );
  return { service, calls, audits, connection };
}

test('P6 OWNER request derives CNPJ from canonical gym and sends only non-secret S2S metadata', async () => {
  const f = fixture();
  const result = await f.service.prepare('gym-tenant-a','owner-a');
  assert.deepEqual(result, {
    status: 'PENDING_UPLOAD', delegationToken: TOKEN,
    expiresAt: result.expiresAt,
    uploadUrl: 'https://nfcore.example/v1/iron/a1/upload',
    credentialCustody: 'NFCORE_DIRECT_VAULT', officialHomologation: 'NOT_VERIFIED',
  });
  assert.match(result.expiresAt, /^\d{4}-\d\d-\d\dT/);
  const post = f.calls.find(x => x.kind === 'post');
  assert.equal(post.path, '/v1/iron/a1/delegations');
  assert.deepEqual(post.body, { issuer_cnpj: CNPJ, actor_user_id: 'owner-a' });
  assert.equal(post.ctx.scope.tenantId, 'nfcore-tenant');
  assert.equal(post.ctx.scope.unitId, 'nfcore-unit');
  assert.equal(post.ctx.credential.reveal(), 'NEVER_SERIALIZE');
  assert.equal(f.audits[0].gymId, 'gym-tenant-a');
  assert.equal(f.audits[0].action, 'FISCAL_A1_DELEGATION_PREPARED');
  assert.doesNotMatch(JSON.stringify(f.audits), /AAAA|NEVER_SERIALIZE|password|pfx/i);
  assert.doesNotMatch(JSON.stringify(result), /NEVER_SERIALIZE|nfcore-tenant|nfcore-unit/i);
});

test('P6 readback is sourced from NFCore and cannot claim homologation', async () => {
  const f = fixture();
  const status = await f.service.status('gym-a');
  assert.equal(status.status, 'STORED');
  assert.equal(status.source, 'NFCORE_VAULT_READBACK');
  assert.equal(status.officialHomologation, 'NOT_VERIFIED');
  assert.deepEqual(f.calls.find(x=>x.kind==='post').body, { issuer_cnpj: CNPJ });
  assert.doesNotMatch(JSON.stringify(status), /password|pfx|nfcore-tenant/i);
});

test('P6 missing or divergent CNPJ blocks before external Vault/S2S calls', async () => {
  for (const params of [
    { financialTaxID: null },
    { financialTaxID: 'bad' },
    { trialCnpj: '22333444000180' },
  ]) {
    const f = fixture(params);
    await assert.rejects(f.service.prepare('gym-a','owner-a'), /CNPJ/);
    assert.equal(f.calls.some(x=>x.kind==='post'||x.kind==='resolve'),false);
    assert.equal(f.audits.length,0);
  }
});

test('P6 reject PROD, missing Bridge and forged delegation response without releasing token', async () => {
  const prod=fixture({environment:IntegrationEnvironment.PROD});
  await assert.rejects(prod.service.prepare('gym-a','owner-a'), /homologacao/);
  assert.equal(prod.calls.some(x=>x.kind==='post'),false);
  const missing=fixture({bridgeMissing:true});
  await assert.rejects(missing.service.prepare('gym-a','owner-a'), /Conexao fiscal/);
  for(const response of [
    { status:'PENDING_UPLOAD', delegation_token:TOKEN, expires_at:new Date(Date.now()+120_000).toISOString(),
      upload_path:'https://evil.example/' },
    { status:'PENDING_UPLOAD', delegation_token:'short', expires_at:new Date(Date.now()+120_000).toISOString(),
      upload_path:'/v1/iron/a1/upload' },
    { status:'PENDING_UPLOAD', delegation_token:TOKEN, expires_at:new Date(Date.now()-1).toISOString(),
      upload_path:'/v1/iron/a1/upload' },
  ]){
    const f=fixture({response});
    await assert.rejects(f.service.prepare('gym-a','owner-a'));
    assert.equal(f.audits.length,0);
  }
});

test('P6 reject forged A1 status with settlement/homologation claim', async () => {
  const f=fixture({response:{
    status:'STORED',expires_at:new Date(Date.now()+5000).toISOString(),
    official_homologation:'PRODUCTION_HOMOLOGATED',
  }});
  await assert.rejects(f.service.status('gym-a'),/Readback/);
});

test('P6 class uses existing tenant-bound role and step-up without any A1 inbound data endpoint', async () => {
  const source=await readFile(new URL('../src/modules/financial/financial.controller.ts',import.meta.url),'utf8');
  const module=await readFile(new URL('../src/modules/financial/financial.module.ts',import.meta.url),'utf8');
  const service=await readFile(new URL('../src/modules/financial/fiscal-a1-delegation.service.ts',import.meta.url),'utf8');
  assert.match(source, /@UseGuards\(JwtAuthGuard, RolesGuard, StepUpGuard\)/);
  assert.match(source, /@Post\('fiscal\/a1\/delegation'\)\s*@Header\('Cache-Control', 'no-store'\)\s*@Roles\('OWNER'\)/);
  assert.match(source, /@Get\('fiscal\/a1\/status'\)\s*@Header\('Cache-Control', 'no-store'\)\s*@Roles\('OWNER'\)/);
  assert.match(source, /fiscalA1Delegation\.prepare\(this\.resolveGymId\(user\), user\.id\)/);
  assert.match(module,/FiscalA1DelegationService/);
  assert.doesNotMatch(source,/pfxBase64|pkcs12|currentPassword.*a1|@Post\('fiscal\/a1\/upload'\)/i);
  assert.doesNotMatch(service,/prisma\.certificate|\.create\(\{.*pkcs12|record\(\{[^}]*delegationToken/s);
});
