import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DOMAIN = 'prisma/creator-network.prisma';
const MIGRATION =
  'prisma/migrations/20260905205000_content_moderation_quality_versioning_lifecycle/migration.sql';
const DTO = 'src/modules/creator-network/dto/content-lifecycle.dto.ts';
const SERVICE = 'src/modules/creator-network/content-lifecycle.service.ts';
const CONTROLLER = 'src/modules/creator-network/content-lifecycle.controller.ts';
const MODULE = 'src/modules/creator-network/creator-network.module.ts';
const DOC = 'docs/CN6_MODERATION_QUALITY_VERSIONING_CONTENT_LIFECYCLE.md';

async function source(path) {
  return readFile(path, 'utf8');
}

function prismaModel(domain, name) {
  return domain.match(new RegExp(`model ${name}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
}

test('CN6 materializes lifecycle, editorial versions and immutable review domain', async () => {
  const domain = await source(DOMAIN);
  const content = prismaModel(domain, 'CreatorContent');
  const version = prismaModel(domain, 'CreatorContentVersion');
  const review = prismaModel(domain, 'CreatorContentReview');

  assert.match(content, /lifecycleStatus\s+CreatorContentLifecycleStatus/);
  assert.match(content, /versions\s+CreatorContentVersion\[\]/);
  assert.match(version, /mediaAssetId\s+String/);
  assert.match(version, /status\s+CreatorContentVersionStatus/);
  assert.match(review, /contentVersionId\s+String\s+@unique/);
  assert.match(review, /decision\s+CreatorContentModerationDecision/);
  assert.doesNotMatch(`${version}\n${review}`, /gymId/);
});

test('CN6 physically constrains lifecycle, one DRAFT, one APPROVED and structured review quality', async () => {
  const migration = await source(MIGRATION);

  assert.match(migration, /CN6_content_lifecycle_state_check/);
  assert.match(migration, /CN6_one_draft_version_uq/);
  assert.match(migration, /CN6_one_approved_version_uq/);
  assert.match(migration, /CN6_review_required_quality_check/);
  assert.match(migration, /CN6_review_decision_quality_check/);
  assert.match(migration, /technicalQuality[\s\S]*NOT_APPLICABLE/);
});

test('CN6 API derives scope from auth and rejects SUPER_ADMIN tenant impersonation', async () => {
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

test('CN6 version creation is monotonic, one-DRAFT-at-a-time and bound to content Media Asset', async () => {
  const service = await source(SERVICE);

  assert.match(service, /CreatorContentVersionStatus\.DRAFT/);
  assert.match(service, /Conteudo ja possui uma versao DRAFT aguardando review/);
  assert.match(service, /versionNumber = \(latest\?\.version \?\? 0\) \+ 1/);
  assert.match(service, /mediaAsset\.contentId !== contentId/);
  assert.match(service, /CONTENT_VERSION_CREATED/);
});

test('CN6 quality is verdict-based and never invents numeric quality scores', async () => {
  const service = await source(SERVICE);
  const dto = await source(DTO);
  const domain = await source(DOMAIN);

  for (const field of [
    'technicalQuality',
    'instructionalQuality',
    'safetyQuality',
    'accessibilityQuality',
  ]) {
    assert.match(`${service}\n${dto}\n${domain}`, new RegExp(field));
  }
  assert.match(service, /APPROVE exige technical, instructional e safety PASS/);
  assert.match(service, /REJECT exige pelo menos um veredito de qualidade FAIL/);
  assert.doesNotMatch(`${service}\n${domain}`, /qualityScore|scoreQuality|rating/i);
});

test('CN6 APPROVE requires current verified CN4 storage and supersedes prior approved version atomically', async () => {
  const service = await source(SERVICE);

  assert.match(service, /assertVerifiedStorage\(tx, version\.mediaAssetId\)/);
  assert.match(service, /CreatorContentVersionStatus\.APPROVED/);
  assert.match(service, /CreatorContentVersionStatus\.SUPERSEDED/);
  assert.match(service, /creatorContentVersion\.updateMany/);
  assert.match(service, /creatorContentReview\.create/);
});

test('CN6 review is immutable with exact idempotent replay only', async () => {
  const service = await source(SERVICE);
  const domain = await source(DOMAIN);

  assert.match(domain, /contentVersionId\s+String\s+@unique/);
  assert.match(service, /Review de versao e imutavel/);
  assert.match(service, /existing\.reviewerUserId === actorUserId/);
  assert.match(service, /idempotent: true/);
  assert.doesNotMatch(service, /creatorContentReview\.update/);
});

test('CN6 approving a new version on ACTIVE content invalidates only mappings for another asset', async () => {
  const service = await source(SERVICE);
  const reviewStart = service.indexOf('async reviewVersion(');
  const activateStart = service.indexOf('async activate(');
  const reviewBody = service.slice(reviewStart, activateStart);

  assert.ok(reviewStart > -1 && activateStart > reviewStart);
  assert.match(
    reviewBody,
    /content\.lifecycleStatus === CreatorContentLifecycleStatus\.ACTIVE[\s\S]*CN6_VERSION_SUPERSEDED/,
  );
  assert.match(service, /exceptMediaAssetId[\s\S]*mediaAssetId: \{ not: exceptMediaAssetId \}/);
  assert.doesNotMatch(
    reviewBody,
    /lifecycleStatus:\s*CreatorContentLifecycleStatus\.ACTIVE/,
  );
});

test('CN6 activate and reactivate require approved version, effective CN2 rights and verified CN4 storage', async () => {
  const service = await source(SERVICE);

  const certificationCalls = service.match(/assertCertification\(tx, context, content\)/g) ?? [];
  assert.ok(certificationCalls.length >= 2);
  assert.match(service, /Conteudo nao possui versao APPROVED/);
  assert.match(service, /CreatorRightsGrantStatus\.ACTIVE/);
  assert.match(service, /CreatorRightsHolderStatus\.ACTIVE/);
  assert.match(service, /CreatorRightsConsentStatus\.ACTIVE/);
  assert.match(service, /creatorMediaStorageObject\.findUnique/);
});

test('CN6 suspension and retirement unpublish mappings atomically while RETIRED remains terminal', async () => {
  const service = await source(SERVICE);

  assert.match(service, /CN6_CONTENT_SUSPENDED/);
  assert.match(service, /CN6_CONTENT_RETIRED/);
  assert.match(service, /CreatorExerciseContentPublicationStatus\.UNPUBLISHED/);
  assert.match(service, /Conteudo RETIRED e terminal/);
  assert.match(service, /CONTENT_LIFECYCLE_SUSPENDED/);
  assert.match(service, /CONTENT_LIFECYCLE_RETIRED/);
});

test('CN6 reactivation is explicit and never republishes mappings as a side effect', async () => {
  const service = await source(SERVICE);

  assert.match(service, /Conteudo SUSPENDED exige reativacao explicita/);
  assert.match(service, /CONTENT_LIFECYCLE_REACTIVATED/);
  assert.match(service, /mappingsRepublished: 0/);
  const reactivateStart = service.indexOf('async reactivate(');
  const retireStart = service.indexOf('async retire(');
  const reactivateBody = service.slice(reactivateStart, retireStart);
  assert.doesNotMatch(reactivateBody, /status:\s*CreatorExerciseContentPublicationStatus\.PUBLISHED/);
});

test('CN6 cutover preserves pre-CN6 mappings but fails them closed until certification', async () => {
  const migration = await source(MIGRATION);

  assert.match(migration, /CN6_CERTIFICATION_REQUIRED/);
  assert.match(
    migration,
    /UPDATE "CreatorExerciseContentMapping"[\s\S]*"status" = 'UNPUBLISHED'/,
  );
  assert.doesNotMatch(migration, /DELETE FROM "CreatorExerciseContentMapping"/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/);
});

test('CN6 database trigger blocks CN5 publication without ACTIVE content and matching APPROVED asset', async () => {
  const migration = await source(MIGRATION);

  assert.match(migration, /cn6_enforce_mapping_certification/);
  assert.match(migration, /content\."lifecycleStatus" = 'ACTIVE'/);
  assert.match(migration, /version\."status" = 'APPROVED'/);
  assert.match(migration, /version\."mediaAssetId" = NEW\."mediaAssetId"/);
  assert.match(migration, /CN6_mapping_certification_trigger/);
});

test('CN6 mutations use Serializable retry and atomic lifecycle audit actions', async () => {
  const service = await source(SERVICE);

  assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(service, /error\.code === 'P2034' \|\| error\.code === 'P2002'/);
  for (const action of [
    'CONTENT_VERSION_CREATED',
    'CONTENT_VERSION_REVIEWED',
    'CONTENT_LIFECYCLE_ACTIVATED',
    'CONTENT_LIFECYCLE_SUSPENDED',
    'CONTENT_LIFECYCLE_REACTIVATED',
    'CONTENT_LIFECYCLE_RETIRED',
  ]) {
    assert.match(service, new RegExp(action));
  }
  assert.match(service, /gymId: context\.gymId/);
});

test('CN6 module is wired while CN7-CN9 and Launch Bridge boundaries remain intact', async () => {
  const service = await source(SERVICE);
  const controller = await source(CONTROLLER);
  const module = await source(MODULE);
  const docs = await source(DOC);
  const migration = await source(MIGRATION);

  assert.match(module, /ContentLifecycleController/);
  assert.match(module, /ContentLifecycleService/);
  assert.match(docs, /CN7: Attribution \+ Usage Metering \+ Engagement Events/);
  assert.match(docs, /`Exercise\.videoUrl` permanece intacto/);
  assert.doesNotMatch(migration, /ALTER TABLE "Exercise"/);
  assert.doesNotMatch(
    `${service}\n${controller}`,
    /usageMeter|engagementEvent|revenueShare|settlement|analytics|\bllm\b|openai/i,
  );
});
