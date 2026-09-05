import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DOMAIN = 'prisma/creator-network.prisma';
const LEGACY_SCHEMA = 'prisma/schema.prisma';
const MIGRATION =
  'prisma/migrations/20260905163500_exercise_content_mapping_publishing/migration.sql';
const DTO = 'src/modules/creator-network/dto/exercise-content-publishing.dto.ts';
const SERVICE = 'src/modules/creator-network/exercise-content-publishing.service.ts';
const CONTROLLER =
  'src/modules/creator-network/exercise-content-publishing.controller.ts';
const MODULE = 'src/modules/creator-network/creator-network.module.ts';
const DOC = 'docs/CN5_EXERCISE_CONTENT_MAPPING_PUBLISHING.md';

async function source(path) {
  return readFile(path, 'utf8');
}

function prismaModel(domain, name) {
  return domain.match(new RegExp(`model ${name}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
}

test('CN5 materializes Exercise to Content mapping with explicit delivery Media Asset', async () => {
  const domain = await source(DOMAIN);
  const mapping = prismaModel(domain, 'CreatorExerciseContentMapping');

  assert.ok(mapping);
  assert.match(mapping, /exerciseId\s+String/);
  assert.match(mapping, /contentId\s+String/);
  assert.match(mapping, /mediaAssetId\s+String/);
  assert.match(mapping, /placement\s+CreatorExerciseContentPlacement/);
  assert.match(mapping, /status\s+CreatorExerciseContentPublicationStatus/);
  assert.match(mapping, /priority\s+Int/);
});

test('CN5 physical migration protects scope, state, foreign keys and one effective PRIMARY', async () => {
  const migration = await source(MIGRATION);

  assert.match(migration, /CN5_scope_gym_check/);
  assert.match(migration, /CN5_publication_state_check/);
  assert.match(migration, /CN5_priority_check/);
  assert.match(migration, /CN5_exercise_fk/);
  assert.match(migration, /REFERENCES "Exercise"\("id"\)/);
  assert.match(migration, /CN5_content_fk/);
  assert.match(migration, /CN5_media_asset_fk/);
  assert.match(migration, /CN5_global_primary_pub_uq/);
  assert.match(migration, /CN5_tenant_primary_pub_uq/);
  assert.match(migration, /WHERE "scope" = 'GLOBAL'[\s\S]*"placement" = 'PRIMARY'[\s\S]*"status" = 'PUBLISHED'/);
});

test('CN5 API derives mapping tenant from authenticated context and rejects SUPER_ADMIN tenant impersonation', async () => {
  const controller = await source(CONTROLLER);
  const dto = await source(DTO);

  assert.match(controller, /scope === 'global'[\s\S]*user\.isSuperAdmin/);
  assert.match(
    controller,
    /scope === 'tenant'[\s\S]*!user\.activeGymId \|\| user\.isSuperAdmin/,
  );
  assert.doesNotMatch(dto, /gymId/);
  assert.match(controller, /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER'\)/);
});

test('CN5 mapping registration is idempotent and refuses silent priority mutation', async () => {
  const service = await source(SERVICE);

  assert.match(service, /creatorExerciseContentMapping\.findFirst/);
  assert.match(service, /existing\.priority === dto\.priority/);
  assert.match(service, /prioridade divergente/);
  assert.match(service, /EXERCISE_CONTENT_MAPPING_REGISTERED/);
});

test('CN5 publish revalidates effective CN2 rights and current CN4 verified storage', async () => {
  const service = await source(SERVICE);

  assert.match(service, /CreatorRightsGrantStatus\.ACTIVE/);
  assert.match(service, /CreatorRightsHolderStatus\.ACTIVE/);
  assert.match(service, /CreatorRightsConsentStatus\.ACTIVE/);
  assert.match(service, /assertVerifiedStorage/);
  assert.match(service, /creatorMediaStorageObject\.findUnique/);
  assert.match(service, /providers\.getConfigured\(\)/);
  assert.match(service, /EXERCISE_CONTENT_MAPPING_PUBLISHED/);
});

test('CN5 tenant publish respects content tenant-private feature and private item limit', async () => {
  const service = await source(SERVICE);

  assert.match(service, /content\.tenant_private/);
  assert.match(service, /content\.private_items_max/);
  assert.match(service, /contentIds\.size >= tenantCommercial\.limit/);
  assert.match(service, /Limite content\.private_items_max atingido/);
});

test('CN5 enforces one PRIMARY PUBLISHED in service in addition to database protection', async () => {
  const service = await source(SERVICE);

  assert.match(service, /CreatorExerciseContentPlacement\.PRIMARY/);
  assert.match(service, /CreatorExerciseContentPublicationStatus\.PUBLISHED/);
  assert.match(service, /Ja existe mapping PRIMARY PUBLISHED/);
});

test('CN5 unpublish requires auditable reason and keeps lifecycle intentionally minimal', async () => {
  const service = await source(SERVICE);
  const dto = await source(DTO);

  assert.match(dto, /MinLength\(3\)/);
  assert.match(dto, /MaxLength\(500\)/);
  assert.match(service, /Unpublish exige motivo auditavel/);
  assert.match(service, /EXERCISE_CONTENT_MAPPING_UNPUBLISHED/);
  assert.doesNotMatch(
    service,
    /moderation|qualityScore|contentVersion|reviewQueue|engagement|revenueShare|settlement|llm|openai/i,
  );
});

test('CN5 runtime resolver consumes canonical PE content capabilities including student preference path', async () => {
  const service = await source(SERVICE);

  for (const key of [
    'content.delivery_mode',
    'content.iron_managed',
    'content.tenant_private',
    'content.external_youtube',
  ]) {
    assert.match(service, new RegExp(key.replace('.', '\\.')));
  }
  assert.match(service, /resolveFeatureForUser/);
  assert.match(service, /resolveFeature\(gymId, featureKey\)/);
});

test('CN5 delivery strategies are deterministic and preserve managed ordering semantics', async () => {
  const service = await source(SERVICE);

  assert.match(service, /mode === 'IRON_ONLY'/);
  assert.match(service, /mode === 'IRON_FIRST'/);
  assert.match(service, /mode === 'TENANT_PRIVATE_FIRST'/);
  assert.match(service, /PRIMARY \? 0 : 1/);
  assert.match(service, /left\.priority - right\.priority/);
  assert.match(service, /left\.id\.localeCompare\(right\.id\)/);
});

test('CN5 managed runtime delegates final delivery and rights enforcement to CN4', async () => {
  const service = await source(SERVICE);

  assert.match(service, /this\.media\.resolveDelivery/);
  assert.match(service, /ConflictException/);
  assert.match(service, /NotFoundException/);
  assert.match(service, /ServiceUnavailableException/);
  assert.match(service, /NO_ELIGIBLE_CONTENT/);
});

test('CN5 preserves Exercise.videoUrl strictly as permitted HTTPS YouTube EXTERNAL_REFERENCE fallback', async () => {
  const service = await source(SERVICE);
  const legacy = await source(LEGACY_SCHEMA);

  assert.match(legacy, /model Exercise\s*\{[\s\S]*videoUrl\s+String\?/);
  assert.match(service, /source: 'Exercise\.videoUrl'/);
  assert.match(service, /parsed\.protocol !== 'https:'/);
  assert.match(service, /youtube\.com/);
  assert.match(service, /youtu\.be/);
  assert.match(service, /externalYoutube === true/);
});

test('CN5 mutations remain Serializable with retry and atomic audit', async () => {
  const service = await source(SERVICE);

  assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(service, /error\.code === 'P2034' \|\| error\.code === 'P2002'/);
  assert.match(service, /EXERCISE_CONTENT_MAPPING_REGISTERED/);
  assert.match(service, /EXERCISE_CONTENT_MAPPING_PUBLISHED/);
  assert.match(service, /EXERCISE_CONTENT_MAPPING_UNPUBLISHED/);
  assert.match(service, /gymId: context\.gymId/);
});

test('CN5 module integrates Product Entitlements without altering its canonical resolver', async () => {
  const module = await source(MODULE);

  assert.match(module, /ProductEntitlementsModule/);
  assert.match(module, /ExerciseContentPublishingController/);
  assert.match(module, /ExerciseContentPublishingService/);
  assert.match(module, /MediaIngestionService/);
});

test('CN5 migration is additive and does not mutate Exercise.videoUrl or unrelated domains', async () => {
  const migration = await source(MIGRATION);

  assert.doesNotMatch(migration, /ALTER TABLE "Exercise"/);
  assert.doesNotMatch(
    migration,
    /ALTER TABLE "(Subscription|Charge|FinancialTransaction|ProductPlan|TenantProductSubscription|Equipment|Aggregator[^\"]*|CreatorRightsGrant|CreatorRightsGrantVersion|CreatorRightsConsent)"/,
  );
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/);
});

test('CN5 documentation freezes CN6-CN9 boundaries and launch bridge compatibility', async () => {
  const docs = await source(DOC);

  assert.match(docs, /CN6/);
  assert.match(docs, /CN7/);
  assert.match(docs, /CN8/);
  assert.match(docs, /CN9/);
  assert.match(docs, /`Exercise\.videoUrl` permanece intocado/);
  assert.match(docs, /EXTERNAL_REFERENCE/);
  assert.match(docs, /não inventa URL, asset, licença ou provider/);
});
