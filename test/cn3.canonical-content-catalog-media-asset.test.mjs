import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DOMAIN = 'prisma/creator-network.prisma';
const MIGRATION =
  'prisma/migrations/20260905153500_canonical_content_catalog_media_asset/migration.sql';
const DTO = 'src/modules/creator-network/dto/content-catalog.dto.ts';
const SERVICE = 'src/modules/creator-network/content-catalog.service.ts';
const CONTROLLER = 'src/modules/creator-network/content-catalog.controller.ts';
const MODULE = 'src/modules/creator-network/creator-network.module.ts';
const DOC = 'docs/CN3_CANONICAL_CONTENT_CATALOG_MEDIA_ASSET_DOMAIN.md';

async function source(path) {
  return readFile(path, 'utf8');
}

function prismaModel(domain, name) {
  return domain.match(new RegExp(`model ${name}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
}

test('CN3 materializes canonical content and logical media asset domain', async () => {
  const domain = await source(DOMAIN);
  const content = prismaModel(domain, 'CreatorContent');
  const asset = prismaModel(domain, 'CreatorMediaAsset');

  assert.ok(content);
  assert.ok(asset);
  assert.match(content, /canonicalKey\s+String/);
  assert.match(content, /rightsGrantId\s+String/);
  assert.match(content, /relationKind\s+CreatorManagedRelationKind/);
  assert.match(content, /mediaAssets\s+CreatorMediaAsset\[\]/);
  assert.match(asset, /integritySha256\s+String/);
  assert.match(asset, /kind\s+CreatorMediaAssetKind/);
});

test('CN3 keeps EXTERNAL_REFERENCE outside managed canonical content', async () => {
  const domain = await source(DOMAIN);
  const contract = await source(
    'src/modules/creator-network/contracts/creator-network-contract.ts',
  );
  const content = prismaModel(domain, 'CreatorContent');

  assert.match(contract, /EXTERNAL_REFERENCE/);
  assert.match(content, /relationKind\s+CreatorManagedRelationKind/);
  assert.doesNotMatch(
    domain.match(/enum CreatorManagedRelationKind\s*\{[\s\S]*?\}/)?.[0] ?? '',
    /EXTERNAL_REFERENCE/,
  );
});

test('CN3 physically constrains content scope, relation kind and canonical identity', async () => {
  const migration = await source(MIGRATION);

  assert.match(migration, /CreatorContent_scope_gym_check/);
  assert.match(migration, /CreatorContent_relation_scope_check/);
  assert.match(migration, /CreatorContent_global_canonical_key_key/);
  assert.match(migration, /CreatorContent_tenant_canonical_key_key/);
  assert.match(migration, /CreatorContent_fingerprint_key/);
  assert.match(
    migration,
    /FOREIGN KEY \("rightsGrantId"\) REFERENCES "CreatorRightsGrant"\("id"\)[\s\S]*ON DELETE RESTRICT/,
  );
});

test('CN3 API derives tenant from authenticated context and DTO never accepts gymId', async () => {
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

test('CN3 scope mapping is fail-closed for TENANT_OWNED versus global managed content', async () => {
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

test('CN3 requires a same-scope effective CN2 rights grant before cataloging managed content', async () => {
  const service = await source(SERVICE);

  assert.match(
    service,
    /creatorRightsGrant\.findFirst[\s\S]*scope: context\.scope[\s\S]*gymId: context\.gymId[\s\S]*relationKind/,
  );
  assert.match(service, /CreatorRightsGrantStatus\.ACTIVE/);
  assert.match(service, /CreatorRightsHolderStatus\.ACTIVE/);
  assert.match(service, /validFrom > now/);
  assert.match(service, /validUntil && active\.validUntil <= now/);
  assert.match(
    service,
    /requiresCreatorConsent[\s\S]*CreatorRightsConsentStatus\.ACTIVE/,
  );
  assert.match(service, /Rights grant nao esta EFFECTIVE para catalogacao/);
});

test('CN3 creator association is authorship metadata and new association requires Creator ACTIVE', async () => {
  const service = await source(SERVICE);
  const domain = await source(DOMAIN);
  const content = prismaModel(domain, 'CreatorContent');

  assert.match(content, /creatorId\s+String\?/);
  assert.match(content, /rightsGrantId\s+String/);
  assert.match(
    service,
    /dto\.creatorId[\s\S]*CreatorStatus\.ACTIVE[\s\S]*Novo conteudo associado a creator exige Creator ACTIVE/,
  );
});

test('CN3 canonical content creation is deterministic, idempotent and rejects divergent reuse of canonicalKey', async () => {
  const service = await source(SERVICE);

  assert.match(
    service,
    /scope: context\.scope[\s\S]*gymId: context\.gymId[\s\S]*canonicalKey/,
  );
  assert.match(service, /creatorContent\.findUnique\([\s\S]*fingerprint/);
  assert.match(service, /sameDefinition/);
  assert.match(service, /canonicalKey ja existe no escopo com definicao diferente/);
});

test('CN3 Media Asset is provider-neutral logical metadata with durable integrity identity', async () => {
  const domain = await source(DOMAIN);
  const migration = await source(MIGRATION);
  const asset = prismaModel(domain, 'CreatorMediaAsset');

  assert.match(asset, /mimeType\s+String/);
  assert.match(asset, /durationMs\s+Int\?/);
  assert.match(asset, /width\s+Int\?/);
  assert.match(asset, /height\s+Int\?/);
  assert.match(asset, /languageCode\s+String\?/);
  assert.doesNotMatch(
    asset,
    /\b(url|storageKey|bucket|objectKey|providerId|cdnUrl|uploadId)\b/i,
  );
  assert.match(migration, /CreatorMediaAsset_integrity_hash_check/);
  assert.match(
    migration,
    /CreatorMediaAsset_contentId_integritySha256_key/,
  );
});

test('CN3 revalidates effective rights before registering each Media Asset', async () => {
  const service = await source(SERVICE);
  const register =
    service.match(/async registerMediaAsset\([\s\S]*?\n  \}\n\}/)?.[0] ?? '';

  assert.match(register, /scopedContent\(tx, context, contentId\)/);
  assert.match(register, /assertEffectiveRights\([\s\S]*content\.rightsGrantId[\s\S]*content\.relationKind/);
  assert.match(register, /contentId_integritySha256/);
  assert.match(register, /Media asset com mesmo hash ja existe com metadados diferentes/);
});

test('CN3 mutations are Serializable, retry known conflicts and audit content plus asset atomically', async () => {
  const service = await source(SERVICE);

  assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(service, /error\.code === 'P2034' \|\| error\.code === 'P2002'/);
  assert.match(service, /CONTENT_CATALOG_ITEM_REGISTERED/);
  assert.match(service, /CONTENT_MEDIA_ASSET_REGISTERED/);
  assert.match(service, /gymId: context\.gymId/);
  assert.match(service, /effectiveRightsVersion: activeVersion\.version/);
});

test('CN3 migration is additive and does not mutate exercise, finance, product, equipment or aggregator tables', async () => {
  const migration = await source(MIGRATION);

  assert.doesNotMatch(
    migration,
    /ALTER TABLE "(Exercise|Subscription|Charge|FinancialTransaction|ProductPlan|TenantProductSubscription|Equipment|Aggregator[^\"]*)"/,
  );
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/);
});

test('CN3 module is registered while CN4-CN9 behavior stays outside runtime', async () => {
  const module = await source(MODULE);
  const service = await source(SERVICE);
  const controller = await source(CONTROLLER);
  const docs = await source(DOC);

  assert.match(module, /ContentCatalogController/);
  assert.match(module, /ContentCatalogService/);
  assert.match(docs, /CN4: ingestão, upload, storage, CDN e abstração de providers/);
  assert.match(docs, /CN5: Exercise ↔ Content Mapping e Publishing Workflow/);
  assert.match(docs, /`Exercise\.videoUrl` não é alterado/);
  assert.doesNotMatch(
    `${service}\n${controller}`,
    /\bexerciseId\b|publishContent|unpublish|ingest|storageKey|cdnUrl|providerId|uploadSession|revenueShare|settlement|engagement/i,
  );
});
