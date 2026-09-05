import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DOMAIN = 'prisma/creator-network.prisma';
const MIGRATION =
  'prisma/migrations/20260905143500_creator_registry_identity_governance/migration.sql';
const SERVICE = 'src/modules/creator-network/creator-registry.service.ts';
const CONTROLLER = 'src/modules/creator-network/creator-registry.controller.ts';
const DOC = 'docs/CN1_CREATOR_REGISTRY_IDENTITY_GOVERNANCE.md';

async function source(path) {
  return readFile(path, 'utf8');
}

function prismaModel(domain, name) {
  return domain.match(new RegExp(`model ${name}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
}

test('CN1 enables Prisma multi-file schema without relocating canonical migrations', async () => {
  const pkg = JSON.parse(await source('package.json'));
  const schema = await source('prisma/schema.prisma');
  const domain = await source(DOMAIN);

  assert.equal(pkg.prisma.schema, './prisma');
  assert.match(schema, /generator client/);
  assert.match(schema, /datasource db/);
  assert.match(domain, /model Creator\s*\{/);
  assert.match(domain, /model CreatorIdentity\s*\{/);
});

test('CN1 Creator Registry remains global and identity does not encode tenant ownership or content rights', async () => {
  const domain = await source(DOMAIN);
  const creator = prismaModel(domain, 'Creator');
  const identity = prismaModel(domain, 'CreatorIdentity');

  assert.ok(creator, 'Creator model must remain present');
  assert.ok(identity, 'CreatorIdentity model must remain present');
  assert.doesNotMatch(creator, /\bgymId\b/);
  assert.doesNotMatch(identity, /\bgymId\b/);
  assert.doesNotMatch(
    identity,
    /rightsHolder|license|consent|contentId|mediaAsset|grantVersion/i,
  );
  assert.match(domain, /enum CreatorStatus\s*\{[\s\S]*PENDING[\s\S]*ACTIVE[\s\S]*SUSPENDED[\s\S]*RETIRED/);
  assert.match(domain, /enum CreatorIdentityStatus\s*\{[\s\S]*UNVERIFIED[\s\S]*VERIFIED[\s\S]*REVOKED/);
});

test('CN1 enforces global identity uniqueness in Prisma and SQL migration', async () => {
  const domain = await source(DOMAIN);
  const migration = await source(MIGRATION);

  assert.match(domain, /@@unique\(\[providerCode, externalSubject\]\)/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "CreatorIdentity_providerCode_externalSubject_key"/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("creatorId"\) REFERENCES "Creator"\("id"\)[\s\S]*ON DELETE RESTRICT/,
  );
});

test('CN1 keeps all creator mutations SUPER_ADMIN-only and exposes no tenant selector', async () => {
  const controller = await source(CONTROLLER);

  const mutationRoles = controller.match(/@Roles\('SUPER_ADMIN'\)/g) ?? [];
  assert.equal(mutationRoles.length, 5);
  assert.doesNotMatch(controller, /gymId|resolveTenantOperationGymId/);
  assert.match(
    controller,
    /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER'\)[\s\S]*findAll/,
  );
});

test('CN1 activation is fail-closed without a VERIFIED identity', async () => {
  const service = await source(SERVICE);

  assert.match(
    service,
    /target === CreatorStatus\.ACTIVE[\s\S]*CreatorIdentityStatus\.VERIFIED[\s\S]*verifiedIdentities === 0[\s\S]*Creator somente pode ficar ACTIVE com identidade VERIFIED/,
  );
  assert.match(service, /CreatorStatus\.RETIRED[\s\S]*lifecycle terminal/);
});

test('CN1 revoking the last verified identity atomically suspends an ACTIVE creator', async () => {
  const service = await source(SERVICE);

  assert.match(
    service,
    /creator\.status === CreatorStatus\.ACTIVE[\s\S]*verifiedIdentities === 0[\s\S]*CreatorStatus\.SUSPENDED/,
  );
  assert.match(service, /CREATOR_AUTO_SUSPENDED_NO_VERIFIED_IDENTITY/);
});

test('CN1 mutations use Serializable retry and atomic platform-level AuditLog events', async () => {
  const service = await source(SERVICE);

  assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(service, /error\.code === 'P2034' \|\| error\.code === 'P2002'/);
  for (const action of [
    'CREATOR_REGISTERED',
    'CREATOR_STATUS_CHANGED',
    'CREATOR_IDENTITY_REGISTERED',
    'CREATOR_IDENTITY_VERIFIED',
    'CREATOR_IDENTITY_REVOKED',
  ]) {
    assert.match(service, new RegExp(action));
  }
  assert.match(service, /gymId: null/);
});

test('CN1 documentation preserves CN2 rights boundary and later Creator Network blocks', async () => {
  const docs = await source(DOC);

  assert.match(docs, /identidade de creator não equivale a titularidade de direitos/i);
  assert.match(docs, /Rights Vault do CN2/);
  assert.match(docs, /Fora do CN1:/);
  assert.match(docs, /CN2-CN9/);
  assert.match(docs, /não cria direitos autorais, licenças, consentimentos/i);
});

test('CN1 module is registered in the application runtime', async () => {
  const app = await source('src/app.module.ts');
  const module = await source('src/modules/creator-network/creator-network.module.ts');

  assert.match(app, /CreatorNetworkModule/);
  assert.match(module, /CreatorRegistryController/);
  assert.match(module, /CreatorRegistryService/);
});
