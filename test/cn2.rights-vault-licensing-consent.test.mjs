import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DOMAIN = 'prisma/creator-network.prisma';
const MIGRATION =
  'prisma/migrations/20260905150500_rights_vault_licensing_consent/migration.sql';
const DTO = 'src/modules/creator-network/dto/rights-vault.dto.ts';
const SERVICE = 'src/modules/creator-network/rights-vault.service.ts';
const CONTROLLER = 'src/modules/creator-network/rights-vault.controller.ts';
const MODULE = 'src/modules/creator-network/creator-network.module.ts';
const DOC = 'docs/CN2_RIGHTS_VAULT_LICENSING_CONSENT_DOMAIN.md';

async function source(path) {
  return readFile(path, 'utf8');
}

test('CN2 materializes holder, versioned grant and consent while its rights records remain content-agnostic', async () => {
  const domain = await source(DOMAIN);
  const grantVersion =
    domain.match(/model CreatorRightsGrantVersion\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  const consent =
    domain.match(/model CreatorRightsConsent\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

  assert.match(domain, /model CreatorRightsHolder\s*\{/);
  assert.match(domain, /model CreatorRightsGrant\s*\{/);
  assert.match(domain, /model CreatorRightsGrantVersion\s*\{/);
  assert.match(domain, /model CreatorRightsConsent\s*\{/);
  assert.doesNotMatch(
    `${grantVersion}\n${consent}`,
    /\bcontentId\b|\bmediaAssetId\b|\bstorageKey\b|\bproviderId\b/,
  );
});

test('CN2 keeps EXTERNAL_REFERENCE outside managed rights grants', async () => {
  const domain = await source(DOMAIN);
  const contract = await source(
    'src/modules/creator-network/contracts/creator-network-contract.ts',
  );

  assert.match(
    contract,
    /EXTERNAL_REFERENCE[\s\S]*LICENSED_CONTENT[\s\S]*IRON_OWNED[\s\S]*TENANT_OWNED/,
  );
  assert.match(
    domain,
    /enum CreatorManagedRelationKind\s*\{[\s\S]*LICENSED_CONTENT[\s\S]*IRON_OWNED[\s\S]*TENANT_OWNED/,
  );
  assert.doesNotMatch(
    domain.match(/enum CreatorManagedRelationKind\s*\{[\s\S]*?\}/)?.[0] ?? '',
    /EXTERNAL_REFERENCE/,
  );
});

test('CN2 physically constrains scope, validity, hashes and one ACTIVE version', async () => {
  const migration = await source(MIGRATION);

  assert.match(migration, /CreatorRightsHolder_scope_gym_check/);
  assert.match(migration, /CreatorRightsGrant_scope_gym_check/);
  assert.match(migration, /CreatorRightsGrant_relation_scope_check/);
  assert.match(migration, /validUntil[\s\S]*validFrom/);
  assert.match(migration, /\^\[0-9A-Fa-f\]\{64\}\$/);
  assert.match(
    migration,
    /CreatorRightsGrantVersion_one_active_per_grant_key[\s\S]*WHERE "status" = 'ACTIVE'/,
  );
  assert.match(
    migration,
    /CreatorRightsConsent_one_active_per_subject_kind_key[\s\S]*WHERE "status" = 'ACTIVE'/,
  );
});

test('CN2 rights holder remains independent from Creator identity', async () => {
  const domain = await source(DOMAIN);
  const service = await source(SERVICE);
  const identityModel =
    domain.match(/model CreatorIdentity\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

  assert.match(domain, /enum CreatorRightsHolderKind[\s\S]*CREATOR[\s\S]*PERSON[\s\S]*ORGANIZATION[\s\S]*TENANT/);
  assert.match(service, /Rights holder CREATOR exige creatorId/);
  assert.match(
    service,
    /creatorId somente e permitido para rights holder CREATOR/,
  );
  assert.doesNotMatch(identityModel, /rightsHolderId|grantVersions|rightsConsents/);
});

test('CN2 API derives tenant from authenticated context and never accepts gymId in DTO', async () => {
  const controller = await source(CONTROLLER);
  const dto = await source(DTO);

  assert.doesNotMatch(dto, /\bgymId\b/);
  assert.match(controller, /scope === 'global'[\s\S]*user\.isSuperAdmin/);
  assert.match(
    controller,
    /scope === 'tenant'[\s\S]*user\.activeGymId[\s\S]*CreatorRightsScope\.TENANT/,
  );
  assert.match(controller, /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER'\)/);
});

test('CN2 grant scope is fail-closed for TENANT_OWNED versus global managed rights', async () => {
  const service = await source(SERVICE);

  assert.match(
    service,
    /context\.scope === CreatorRightsScope\.TENANT[\s\S]*relationKind !== CreatorManagedRelationKind\.TENANT_OWNED/,
  );
  assert.match(
    service,
    /context\.scope === CreatorRightsScope\.GLOBAL[\s\S]*relationKind === CreatorManagedRelationKind\.TENANT_OWNED/,
  );
});

test('CN2 version activation requires latest DRAFT and atomically supersedes prior ACTIVE', async () => {
  const service = await source(SERVICE);

  assert.match(
    service,
    /target\.status !== CreatorRightsGrantStatus\.DRAFT[\s\S]*Somente a versao mais recente pode ser ativada/,
  );
  assert.match(
    service,
    /status: CreatorRightsGrantStatus\.SUPERSEDED[\s\S]*RIGHTS_GRANT_VERSION_SUPERSEDED/,
  );
  assert.match(service, /RIGHTS_GRANT_VERSION_ACTIVATED/);
});

test('CN2 activation and resume fail closed on holder, validity and required consent', async () => {
  const service = await source(SERVICE);

  assert.match(service, /Rights holder nao esta ACTIVE/);
  assert.match(service, /Rights grant ainda nao esta vigente/);
  assert.match(service, /Rights grant expirou/);
  assert.match(
    service,
    /requiresCreatorConsent[\s\S]*CreatorRightsConsentStatus\.ACTIVE[\s\S]*validConsents === 0/,
  );
  assert.match(service, /assertTermsEffective\(tx, context, target, now\)/);
  assert.match(service, /assertTermsEffective\(tx, context, version, now\)/);
});

test('CN2 consent is versioned and revoking last required consent suspends ACTIVE grant atomically', async () => {
  const service = await source(SERVICE);
  const domain = await source(DOMAIN);

  assert.match(
    domain,
    /enum CreatorRightsConsentStatus\s*\{[\s\S]*ACTIVE[\s\S]*SUPERSEDED[\s\S]*REVOKED/,
  );
  assert.match(service, /RIGHTS_CONSENT_SUPERSEDED/);
  assert.match(service, /RIGHTS_CONSENT_RECORDED/);
  assert.match(service, /RIGHTS_CONSENT_REVOKED/);
  assert.match(
    service,
    /remaining === 0[\s\S]*CreatorRightsGrantStatus\.SUSPENDED[\s\S]*REQUIRED_CREATOR_CONSENT_REVOKED/,
  );
  assert.match(service, /RIGHTS_GRANT_AUTO_SUSPENDED_NO_REQUIRED_CONSENT/);
});

test('CN2 evaluates rights as structured dimensions and deterministic fail-closed reasons', async () => {
  const service = await source(SERVICE);

  for (const token of [
    'LATEST_VERSION_',
    'RIGHTS_HOLDER_INACTIVE',
    'NOT_YET_VALID',
    'EXPIRED',
    'REQUIRED_CREATOR_CONSENT_MISSING',
    'EFFECTIVE',
  ]) {
    assert.match(service, new RegExp(token));
  }
  for (const dimension of [
    'rightsHolderId',
    'basisKind',
    'usageScopes',
    'deliveryScopes',
    'territories',
    'validFrom',
    'validUntil',
    'attributionRequired',
    'evidenceSha256',
    'requiresCreatorConsent',
  ]) {
    assert.match(service, new RegExp(dimension));
  }
});

test('CN2 mutations are Serializable, retry known conflicts and audit global/tenant context atomically', async () => {
  const service = await source(SERVICE);

  assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(service, /error\.code === 'P2034' \|\| error\.code === 'P2002'/);
  for (const action of [
    'RIGHTS_HOLDER_REGISTERED',
    'RIGHTS_HOLDER_RETIRED',
    'RIGHTS_GRANT_CREATED',
    'RIGHTS_GRANT_VERSION_CREATED',
    'RIGHTS_GRANT_VERSION_ACTIVATED',
    'RIGHTS_GRANT_VERSION_SUSPENDED',
    'RIGHTS_GRANT_VERSION_RESUMED',
    'RIGHTS_GRANT_VERSION_REVOKED',
    'RIGHTS_CONSENT_RECORDED',
    'RIGHTS_CONSENT_REVOKED',
  ]) {
    assert.match(service, new RegExp(action));
  }
  assert.match(service, /gymId: context\.gymId/);
});

test('CN2 migration is additive and does not mutate finance, product, equipment, aggregator or exercise tables', async () => {
  const migration = await source(MIGRATION);

  assert.doesNotMatch(
    migration,
    /ALTER TABLE "(Subscription|Charge|FinancialTransaction|ProductPlan|TenantProductSubscription|Equipment|Exercise|Aggregator[^\"]*)"/,
  );
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/);
});

test('CN2 documentation and module preserve CN3-CN9 boundaries', async () => {
  const docs = await source(DOC);
  const module = await source(MODULE);
  const service = await source(SERVICE);
  const controller = await source(CONTROLLER);

  assert.match(docs, /CN3-CN9/);
  assert.match(docs, /CN2 ainda não liga grant a conteúdo/);
  assert.match(docs, /EXTERNAL_REFERENCE.*fora de managed rights/i);
  assert.match(module, /RightsVaultController/);
  assert.match(module, /RightsVaultService/);
  assert.doesNotMatch(`${service}\n${controller}`, /\bcontentId\b|MediaAsset|storage|CDN|publishContent/);
});
