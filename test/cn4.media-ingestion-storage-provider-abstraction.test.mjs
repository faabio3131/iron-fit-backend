import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DOMAIN = 'prisma/creator-network.prisma';
const MIGRATION =
  'prisma/migrations/20260905160000_media_ingestion_storage_provider_abstraction/migration.sql';
const DTO = 'src/modules/creator-network/dto/media-ingestion.dto.ts';
const SERVICE = 'src/modules/creator-network/media-ingestion.service.ts';
const CONTROLLER = 'src/modules/creator-network/media-ingestion.controller.ts';
const CONTRACT = 'src/modules/creator-network/media/media-provider.contract.ts';
const REGISTRY = 'src/modules/creator-network/media/media-provider.registry.ts';
const MODULE = 'src/modules/creator-network/creator-network.module.ts';
const DOC = 'docs/CN4_MEDIA_INGESTION_STORAGE_PROVIDER_ABSTRACTION.md';

async function source(path) {
  return readFile(path, 'utf8');
}

function prismaModel(domain, name) {
  return domain.match(new RegExp(`model ${name}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
}

test('CN4 materializes technical ingestion and verified storage without changing canonical asset identity', async () => {
  const domain = await source(DOMAIN);
  const asset = prismaModel(domain, 'CreatorMediaAsset');
  const ingestion = prismaModel(domain, 'CreatorMediaIngestion');
  const storage = prismaModel(domain, 'CreatorMediaStorageObject');

  assert.ok(ingestion);
  assert.ok(storage);
  assert.match(asset, /ingestions\s+CreatorMediaIngestion\[\]/);
  assert.match(asset, /storageObjects\s+CreatorMediaStorageObject\[\]/);
  assert.match(ingestion, /status\s+CreatorMediaIngestionStatus/);
  assert.match(storage, /integritySha256\s+String/);
  assert.match(storage, /sizeBytes\s+BigInt/);
});

test('CN4 provider contract is vendor-neutral and contains no invented endpoint or credential', async () => {
  const contract = await source(CONTRACT);

  for (const capability of ['prepareUpload', 'inspectObject', 'resolveDelivery']) {
    assert.match(contract, new RegExp(capability));
  }
  assert.doesNotMatch(
    contract,
    /amazonaws|cloudflare|r2\.|s3\.|accessKey|secretKey|apiKey|bearer|bucketName|regionName/i,
  );
});

test('CN4 registry selects provider server-side and fails closed when config or homologated adapter is absent', async () => {
  const registry = await source(REGISTRY);
  const dto = await source(DTO);

  assert.match(registry, /process\.env\.IRON_MEDIA_PROVIDER_CODE/);
  assert.match(registry, /nao esta configurado\/homologado/);
  assert.match(registry, /nao esta registrado\/homologado/);
  assert.doesNotMatch(dto, /providerCode|gymId/);
});

test('CN4 physically constrains ingestion state, technical failure reasons and verified storage identity', async () => {
  const migration = await source(MIGRATION);

  assert.match(migration, /CreatorMediaIngestion_state_check/);
  assert.match(migration, /CreatorMediaIngestion_provider_code_check/);
  assert.match(migration, /CreatorMediaStorageObject_integrity_hash_check/);
  assert.match(migration, /CreatorMediaStorageObject_size_check/);
  assert.match(migration, /CreatorMediaIngestion_mediaAssetId_requestKey_key/);
  assert.match(migration, /CreatorMediaStorageObject_mediaAssetId_providerCode_key/);
  assert.match(migration, /CreatorMediaStorageObject_providerCode_objectKey_key/);
});

test('CN4 API derives tenant from auth and does not allow SUPER_ADMIN tenant impersonation', async () => {
  const controller = await source(CONTROLLER);
  const dto = await source(DTO);

  assert.match(controller, /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER'\)/);
  assert.match(controller, /scope === 'global'[\s\S]*user\.isSuperAdmin/);
  assert.match(
    controller,
    /scope === 'tenant'[\s\S]*!user\.activeGymId \|\| user\.isSuperAdmin/,
  );
  assert.doesNotMatch(dto, /gymId/);
});

test('CN4 prepare is idempotent by asset requestKey and never lets request choose provider', async () => {
  const service = await source(SERVICE);
  const dto = await source(DTO);

  assert.match(service, /mediaAssetId_requestKey/);
  assert.match(service, /requestKey: dto\.requestKey/);
  assert.match(service, /providers\.getConfigured\(\)/);
  assert.doesNotMatch(dto, /provider/);
  assert.match(service, /requestKey de ingestao ja terminou em FAILED/);
});

test('CN4 revalidates CN2 rights before prepare, verify promotion and delivery', async () => {
  const service = await source(SERVICE);

  assert.match(service, /CreatorRightsGrantStatus\.ACTIVE/);
  assert.match(service, /CreatorRightsHolderStatus\.ACTIVE/);
  assert.match(service, /CreatorRightsConsentStatus\.ACTIVE/);
  const calls = service.match(/assertEffectiveRights\(/g) ?? [];
  assert.ok(calls.length >= 4, `expected repeated rights checks, found ${calls.length}`);
  assert.match(service, /Rights grant da media expirou/);
});

test('CN4 verify requires real provider SHA-256 and refuses ETag-only integrity', async () => {
  const service = await source(SERVICE);

  assert.match(service, /inspected\.sha256/);
  assert.match(service, /INTEGRITY_HASH_UNAVAILABLE/);
  assert.match(service, /INTEGRITY_MISMATCH/);
  assert.match(service, /actualSha256 !== snapshot\.mediaAsset\.integritySha256/);
  assert.match(service, /Provider nao comprovou SHA-256 verificavel do objeto/);
});

test('CN4 only creates storage object after valid inspection and final serializable rights recheck', async () => {
  const service = await source(SERVICE);
  const createPosition = service.indexOf('creatorMediaStorageObject.create');
  const inspectPosition = service.indexOf('provider.inspectObject');
  const finalRightsPosition = service.lastIndexOf('assertEffectiveRights(');

  assert.ok(inspectPosition > -1);
  assert.ok(createPosition > inspectPosition);
  assert.ok(finalRightsPosition > inspectPosition);
  assert.match(service, /CreatorMediaIngestionStatus\.VERIFIED/);
  assert.match(service, /MEDIA_INGESTION_VERIFIED/);
});

test('CN4 records provider failures durably without persisting raw provider errors', async () => {
  const service = await source(SERVICE);

  assert.match(service, /MEDIA_INGESTION_FAILED/);
  assert.match(service, /PROVIDER_PREPARE_FAILED/);
  assert.match(service, /PROVIDER_INSPECTION_FAILED/);
  assert.match(service, /OBJECT_NOT_FOUND/);
  assert.match(service, /INVALID_OBJECT_SIZE/);
  assert.doesNotMatch(service, /next:\s*\{[\s\S]*error\.message/);
});

test('CN4 upload and delivery references are HTTPS, ephemeral and absent from Prisma persistence', async () => {
  const service = await source(SERVICE);
  const domain = await source(DOMAIN);
  const ingestion = prismaModel(domain, 'CreatorMediaIngestion');
  const storage = prismaModel(domain, 'CreatorMediaStorageObject');

  assert.match(service, /parsed\.protocol !== 'https:'/);
  assert.match(service, /upload\.expiresAt <= new Date\(\)/);
  assert.match(service, /delivery\.expiresAt && delivery\.expiresAt <= new Date\(\)/);
  assert.doesNotMatch(
    `${ingestion}\n${storage}`,
    /uploadUrl|deliveryUrl|signedUrl|headers|credential|token/i,
  );
});

test('CN4 mutations use Serializable retry and atomic audit actions', async () => {
  const service = await source(SERVICE);

  assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(service, /error\.code === 'P2034' \|\| error\.code === 'P2002'/);
  assert.match(service, /MEDIA_INGESTION_PREPARED/);
  assert.match(service, /MEDIA_INGESTION_FAILED/);
  assert.match(service, /MEDIA_INGESTION_VERIFIED/);
  assert.match(service, /gymId: context\.gymId/);
});

test('CN4 migration is additive and does not mutate exercise, finance, product, equipment, aggregator or rights tables', async () => {
  const migration = await source(MIGRATION);

  assert.doesNotMatch(
    migration,
    /ALTER TABLE "(Exercise|Subscription|Charge|FinancialTransaction|ProductPlan|TenantProductSubscription|Equipment|Aggregator[^\"]*|CreatorRightsGrant|CreatorRightsGrantVersion|CreatorRightsConsent)"/,
  );
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/);
});

test('CN4 preserves CN5-CN9 boundaries and Exercise.videoUrl launch bridge', async () => {
  const service = await source(SERVICE);
  const controller = await source(CONTROLLER);
  const docs = await source(DOC);
  const module = await source(MODULE);

  assert.match(module, /MediaIngestionController/);
  assert.match(module, /MediaIngestionService/);
  assert.match(module, /CreatorMediaProviderRegistry/);
  assert.match(docs, /CN5: Exercise ↔ Content Mapping \+ Publishing Workflow/);
  assert.match(docs, /`Exercise\.videoUrl` permanece intacto/);
  assert.match(docs, /pendência externa legítima/i);
  assert.doesNotMatch(
    `${service}\n${controller}`,
    /\bexerciseId\b|publishContent|unpublish|moderation|qualityScore|engagement|revenueShare|settlement|llm|openai/i,
  );
});
