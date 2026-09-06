import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DOMAIN = 'prisma/creator-network.prisma';
const MIGRATION =
  'prisma/migrations/20260905223000_attribution_usage_metering_engagement_events/migration.sql';
const DTO = 'src/modules/creator-network/dto/content-usage.dto.ts';
const SERVICE = 'src/modules/creator-network/content-usage.service.ts';
const CONTROLLER =
  'src/modules/creator-network/exercise-content-publishing.controller.ts';
const MODULE = 'src/modules/creator-network/creator-network.module.ts';
const DOC = 'docs/CN7_ATTRIBUTION_USAGE_METERING_ENGAGEMENT_EVENTS.md';

async function source(path) {
  return readFile(path, 'utf8');
}

function prismaModel(domain, name) {
  return domain.match(new RegExp(`model ${name}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
}

test('CN7 materializes attribution snapshot, usage session and append-only engagement event domain', async () => {
  const domain = await source(DOMAIN);
  const attribution = prismaModel(domain, 'CreatorContentAttributionSnapshot');
  const session = prismaModel(domain, 'CreatorContentUsageSession');
  const event = prismaModel(domain, 'CreatorContentUsageEvent');

  assert.match(attribution, /contentVersionId\s+String/);
  assert.match(attribution, /rightsGrantVersionId\s+String/);
  assert.match(attribution, /rightsHolderId\s+String/);
  assert.match(session, /deliveryKind\s+CreatorUsageDeliveryKind/);
  assert.match(session, /resolutionKey\s+String/);
  assert.match(event, /eventType\s+CreatorUsageEventType/);
  assert.match(event, /observationSource\s+CreatorUsageObservationSource/);
});

test('CN7 attribution keeps creator credit distinct from rights ownership and snapshots required attribution text', async () => {
  const service = await source(SERVICE);
  const domain = await source(DOMAIN);

  assert.match(service, /rightsHolderId: rights\.rightsHolderId/);
  assert.match(service, /creatorDisplayName/);
  assert.match(service, /creatorCreditIsRightsOwnership: false/);
  assert.match(service, /Rights exige attribution, mas attributionText esta ausente/);
  assert.doesNotMatch(domain, /revenueShare|commission|settlementAmount|payableAmount/i);
});

test('CN7 migration physically protects attribution, usage shapes and immutable ledger', async () => {
  const migration = await source(MIGRATION);

  assert.match(migration, /CN7_attribution_text_check/);
  assert.match(migration, /CN7_usage_delivery_shape_check/);
  assert.match(migration, /CN7_usage_event_semantics_check/);
  assert.match(migration, /CN7_one_delivery_resolved_per_session_uq/);
  assert.match(migration, /CN7_one_opened_per_session_uq/);
  assert.match(migration, /CN7_one_terminal_event_per_session_uq/);
  assert.match(migration, /CN7_attribution_snapshot_append_only_trigger/);
  assert.match(migration, /CN7_usage_session_append_only_trigger/);
  assert.match(migration, /CN7_usage_event_append_only_trigger/);
});

test('CN7 API derives tenant and user from auth and requires an idempotent usage header', async () => {
  const controller = await source(CONTROLLER);
  const dto = await source(DTO);

  assert.match(controller, /@Headers\('x-iron-usage-key'\)/);
  assert.match(controller, /!user\.activeGymId \|\| user\.isSuperAdmin/);
  assert.match(controller, /user\.activeGymId[\s\S]*user\.id/);
  assert.match(controller, /@Roles\('OWNER', 'MANAGER', 'TRAINER', 'STUDENT'\)/);
  assert.doesNotMatch(dto, /gymId|userId|exerciseId|sessionId/);
});

test('CN7 resolution key is UUID validated and physically unique by tenant plus authenticated user', async () => {
  const service = await source(SERVICE);
  const domain = await source(DOMAIN);
  const migration = await source(MIGRATION);

  assert.match(service, /x-iron-usage-key deve ser UUID valido/);
  assert.match(domain, /@@unique\(\[gymId, actorUserId, resolutionKey\]\)/);
  assert.match(migration, /CN7_usage_resolution_key_uuid_check/);
  assert.match(migration, /CreatorContentUsageSession_gym_actor_resolution_key/);
});

test('CN7 managed metering revalidates CN5 mapping, CN6 lifecycle/version and CN2 effective rights', async () => {
  const service = await source(SERVICE);

  assert.match(service, /CreatorExerciseContentPublicationStatus\.PUBLISHED/);
  assert.match(service, /CreatorContentLifecycleStatus\.ACTIVE/);
  assert.match(service, /CreatorContentVersionStatus\.APPROVED/);
  assert.match(service, /CreatorRightsGrantStatus\.ACTIVE/);
  assert.match(service, /CreatorRightsHolderStatus\.ACTIVE/);
  assert.match(service, /CreatorRightsConsentStatus\.ACTIVE/);
  assert.match(service, /Mapping deixou de estar PUBLISHED antes do metering/);
});

test('CN7 managed attribution snapshot is deterministic and reused instead of silently mutating history', async () => {
  const service = await source(SERVICE);

  assert.match(service, /snapshotFingerprint = this\.fingerprint/);
  assert.match(service, /creatorContentAttributionSnapshot\.findUnique/);
  assert.match(service, /creatorContentAttributionSnapshot\.create/);
  assert.doesNotMatch(service, /creatorContentAttributionSnapshot\.update/);
  assert.doesNotMatch(service, /creatorContentAttributionSnapshot\.delete/);
});

test('CN7 DELIVERY_RESOLVED is server-observed resolution evidence and never claims playback completion', async () => {
  const service = await source(SERVICE);
  const migration = await source(MIGRATION);

  assert.match(service, /CreatorUsageEventType\.DELIVERY_RESOLVED/);
  assert.match(service, /CreatorUsageObservationSource\.SERVER_OBSERVED/);
  assert.match(migration, /'DELIVERY_RESOLVED'[\s\S]*'SERVER_OBSERVED'/);
  assert.doesNotMatch(service, /DELIVERY_RESOLVED[\s\S]{0,120}progressPercent:\s*100/);
});

test('CN7 external references cannot fabricate progress or completion outside IRON observability', async () => {
  const service = await source(SERVICE);
  const migration = await source(MIGRATION);

  assert.match(service, /Referencia externa nao permite alegar progresso\/completion/);
  assert.match(service, /Referencia externa nao aceita progressPercent/);
  assert.match(service, /externalReferenceSource: 'Exercise\.videoUrl'/);
  assert.match(migration, /"externalReferenceSource" = 'Exercise\.videoUrl'/);
});

test('CN7 engagement DTO and service enforce explicit event semantics', async () => {
  const dto = await source(DTO);
  const service = await source(SERVICE);

  for (const event of [
    'CONTENT_OPENED',
    'CONTENT_PROGRESS',
    'CONTENT_COMPLETED',
    'CONTENT_DISMISSED',
  ]) {
    assert.match(dto, new RegExp(event));
  }
  assert.match(service, /CONTENT_PROGRESS exige progressPercent entre 1 e 99/);
  assert.match(service, /CONTENT_COMPLETED exige progressPercent = 100/);
  assert.match(service, /CONTENT_OPENED nao aceita progressPercent/);
});

test('CN7 engagement requires opened-before-progress, monotonic progress and one terminal event', async () => {
  const service = await source(SERVICE);

  assert.match(service, /Progress\/completion exige CONTENT_OPENED anterior/);
  assert.match(service, /CONTENT_PROGRESS deve ser monotonicamente crescente/);
  assert.match(service, /Usage session ja possui evento terminal/);
  assert.match(service, /CONTENT_DISMISSED nao pode regredir progressPercent observado/);
});

test('CN7 session and event replay are exact-idempotent while divergent reuse fails closed', async () => {
  const service = await source(SERVICE);
  const domain = await source(DOMAIN);

  assert.match(service, /x-iron-usage-key ja foi usado para outra resolucao/);
  assert.match(service, /eventKey ja utilizado com payload divergente/);
  assert.match(service, /idempotent: true/);
  assert.match(domain, /@@unique\(\[usageSessionId, eventKey\]\)/);
});

test('CN7 engagement binds the session to tenant, authenticated user and route exercise', async () => {
  const service = await source(SERVICE);
  const controller = await source(CONTROLLER);

  assert.match(service, /where: \{ id: usageSessionId, gymId, actorUserId, exerciseId \}/);
  assert.match(controller, /recordEngagement\([\s\S]*user\.activeGymId,[\s\S]*user\.id,[\s\S]*exerciseId,[\s\S]*sessionId/);
});

test('CN7 mutations use Serializable retry to make metering duplicate-safe under concurrency', async () => {
  const service = await source(SERVICE);

  assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(service, /error\.code === 'P2034' \|\| error\.code === 'P2002'/);
  assert.match(service, /creatorContentUsageSession\.findUnique/);
  assert.match(service, /creatorContentUsageEvent\.findUnique/);
});

test('CN7 module is wired and content resolution delegates eligibility to canonical CN5 publishing service', async () => {
  const module = await source(MODULE);
  const service = await source(SERVICE);

  assert.match(module, /ContentUsageService/);
  assert.match(service, /private readonly publishing: ExerciseContentPublishingService/);
  assert.match(service, /this\.publishing\.resolveExerciseContent/);
});

test('CN7 remains additive and does not anticipate CN8 commercial settlement or CN9 analytics', async () => {
  const migration = await source(MIGRATION);
  const service = await source(SERVICE);
  const controller = await source(CONTROLLER);
  const docs = await source(DOC);

  assert.match(docs, /CN8: Commercial Rules \+ Revenue Share \+ Settlement/);
  assert.match(docs, /CN9: Operational Console \+ Analytics/);
  assert.doesNotMatch(`${service}\n${controller}`, /revenueShare|settlement|payable|commission|dashboard|analytics|openai|\bllm\b/i);
  assert.doesNotMatch(migration, /ALTER TABLE "Exercise"|ALTER TABLE "Subscription"|ALTER TABLE "Charge"|ALTER TABLE "ProductPlan"|ALTER TABLE "Aggregator/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/);
});
