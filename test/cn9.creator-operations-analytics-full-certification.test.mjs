import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const SPEC = 'docs/CN9_CREATOR_OPERATIONS_ANALYTICS_SPECIFICATION.md';
const CONSOLE =
  'src/modules/creator-network/creator-operations-console.service.ts';
const ANALYTICS = 'src/modules/creator-network/creator-analytics.service.ts';
const CONTROLLER = 'src/modules/creator-network/creator-operations.controller.ts';
const MODULE = 'src/modules/creator-network/creator-network.module.ts';

async function source(path) {
  return readFile(path, 'utf8');
}

test('CN9 specification freezes CN1-CN8 as the only canonical data sources and creates no analytics source of truth', async () => {
  const spec = await source(SPEC);
  for (let block = 1; block <= 8; block += 1) {
    assert.match(spec, new RegExp(`CN${block} —`));
  }
  assert.match(spec, /Não existe migration CN9/);
  assert.match(spec, /não existe tabela de dashboard\/analytics/);
  assert.match(spec, /read-only/i);
});

test('CN9 controller enforces GLOBAL SUPER_ADMIN and TENANT authenticated OWNER or MANAGER without client gym authority', async () => {
  const controller = await source(CONTROLLER);

  assert.match(controller, /@UseGuards\(JwtAuthGuard, RolesGuard\)/);
  assert.match(controller, /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER'\)/);
  assert.match(controller, /Creator Operations GLOBAL exige SUPER_ADMIN/);
  assert.match(
    controller,
    /Creator Operations TENANT exige OWNER\/MANAGER com tenant autenticado/,
  );
  assert.match(controller, /user\.activeGymId/);
  assert.match(controller, /user\.isSuperAdmin/);
  assert.doesNotMatch(controller, /@Query\(['"](?:gymId|activeGymId|userId)['"]\)/);
  assert.doesNotMatch(controller, /@Body\(/);
});

test('CN9 exposes only read endpoints for overview and analytics', async () => {
  const controller = await source(CONTROLLER);

  assert.match(controller, /@Get\(':scope\/overview'\)/);
  assert.match(controller, /@Get\(':scope\/analytics'\)/);
  assert.doesNotMatch(controller, /@(Post|Put|Patch|Delete)\(/);
});

test('CN9 services are structurally read-only and never mutate Prisma state', async () => {
  const services = `${await source(CONSOLE)}\n${await source(ANALYTICS)}`;

  assert.doesNotMatch(
    services,
    /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
  );
  assert.doesNotMatch(services, /\$transaction|\$executeRaw|\$queryRaw/);
  assert.doesNotMatch(services, /AuditService/);
  assert.match(services, /\.groupBy\(/);
  assert.match(services, /\.count\(/);
});

test('CN9 operational console consolidates governed Creator, Rights, Content, Moderation, Media and Publishing facts', async () => {
  const service = await source(CONSOLE);

  for (const delegate of [
    'creator.groupBy',
    'creatorRightsGrantVersion.groupBy',
    'creatorContent.groupBy',
    'creatorContentVersion.groupBy',
    'creatorContentReview.groupBy',
    'creatorMediaIngestion.groupBy',
    'creatorExerciseContentMapping.groupBy',
  ]) {
    assert.match(service, new RegExp(delegate.replace('.', '\\.')));
  }
  assert.match(service, /RIGHTS_ATTENTION_DAYS = 30/);
  assert.match(service, /expiredButStillActiveRecords/);
});

test('CN9 tenant operational projection scopes every content-owned fact to authenticated scope and gym', async () => {
  const service = await source(CONSOLE);

  assert.match(service, /scope: context\.scope/);
  assert.match(service, /gymId: context\.gymId/);
  assert.match(
    service,
    /context\.scope === CreatorRightsScope\.TENANT[\s\S]*contents: \{ some: scopedContent \}/,
  );
  assert.match(service, /where: \{ grant: scopedGrant \}/);
  assert.match(service, /where: \{ content: scopedContent \}/);
  assert.match(service, /mediaAsset: \{ content: scopedContent \}/);
});

test('CN9 analytics reads CN7 usage and engagement as aggregated observed facts', async () => {
  const service = await source(ANALYTICS);

  assert.match(service, /creatorContentUsageSession\.groupBy/);
  assert.match(service, /creatorContentUsageEvent\.groupBy/);
  assert.match(service, /by: \['deliveryKind'\]/);
  assert.match(service, /by: \['eventType'\]/);
  assert.match(service, /by: \['observationSource'\]/);
  assert.match(service, /observedAt: \{ gte: window\.since, lte: window\.to \}/);
});

test('CN9 protects PII by never projecting user, reviewer or beneficiary legal identity from services', async () => {
  const services = `${await source(CONSOLE)}\n${await source(ANALYTICS)}`;

  assert.doesNotMatch(
    services,
    /actorUserId|reviewerUserId|beneficiaryLegalName|\blegalName\b|email|phone|refreshToken|password/i,
  );
});

test('CN9 monetary analytics uses integer minor units with BigInt serialization and never float rounding', async () => {
  const service = await source(ANALYTICS);
  const spec = await source(SPEC);

  assert.match(service, /BigInt\(value \?\? 0\)\.toString\(\)/);
  assert.match(service, /_sum: \{ amountMinor: true \}/);
  assert.match(service, /_sum: \{ totalAmountMinor: true \}/);
  assert.doesNotMatch(service, /toFixed|parseFloat|Math\.round/);
  assert.match(spec, /minor units inteiros/);
});

test('CN9 never mixes currencies and keeps accrual and settlement buckets semantically separate', async () => {
  const service = await source(ANALYTICS);

  assert.match(service, /by: \['currency'\]/);
  assert.match(service, /by: \['currency', 'status'\]/);
  assert.match(service, /new Map<[\s\S]*currency: string/);
  assert.match(service, /accrualsByConsumptionCurrency/);
  assert.match(service, /settlementBatchesByCurrency/);
});

test('CN9 tenant commercial analytics binds accrual to consumption gym and settlement to tenant-owned scope', async () => {
  const service = await source(ANALYTICS);

  assert.match(service, /consumptionGymId: context\.gymId as string/);
  assert.match(
    service,
    /scope: CreatorRightsScope\.TENANT,[\s\S]*gymId: context\.gymId as string/,
  );
});

test('CN9 analytics window is bounded and cannot become an unbounded query', async () => {
  const service = await source(ANALYTICS);

  assert.match(service, /DEFAULT_WINDOW_DAYS = 30/);
  assert.match(service, /MAX_WINDOW_DAYS = 365/);
  assert.match(service, /!Number\.isInteger\(days\) \|\| days < 1 \|\| days > MAX_WINDOW_DAYS/);
});

test('CN9 module wires operations controller and both read-only services', async () => {
  const module = await source(MODULE);

  assert.match(module, /CreatorOperationsController/);
  assert.match(module, /CreatorOperationsConsoleService/);
  assert.match(module, /CreatorAnalyticsService/);
  assert.match(
    module,
    /controllers:[\s\S]*CreatorCommercialController,[\s\S]*CreatorOperationsController/,
  );
});

test('CN9 implementation contains no AI, forecast, provider call or financial execution path', async () => {
  const runtime = `${await source(CONSOLE)}\n${await source(ANALYTICS)}\n${await source(CONTROLLER)}`;

  assert.doesNotMatch(
    runtime,
    /openai|\bllm\b|machine learning|forecast|recommendation|paymentExecution|pix|gateway|WELLHUB_PARTNER_TRANSPORT|TOTALPASS_PARTNER_TRANSPORT/i,
  );
});

test('CN9 full certification preserves permanent CN0-CN9 documentation and regression files with no explicit skips', async () => {
  const testFiles = (await readdir('test')).filter((name) => name.endsWith('.test.mjs'));
  const docs = await readdir('docs');

  assert.ok(testFiles.length >= 44, `expected at least 44 test files, found ${testFiles.length}`);
  for (let block = 0; block <= 9; block += 1) {
    const testPrefix = `cn${block}.`;
    const docPrefix = `CN${block}_`;
    assert.ok(
      testFiles.some((name) => name.startsWith(testPrefix)),
      `missing permanent ${testPrefix} regression`,
    );
    assert.ok(
      docs.some((name) => name.startsWith(docPrefix)),
      `missing canonical ${docPrefix} documentation`,
    );
  }

  const creatorTests = testFiles.filter((name) => /^cn\d+\./.test(name));
  for (const file of creatorTests) {
    assert.doesNotMatch(await source(`test/${file}`), /\b(?:test|describe)\.skip\s*\(/);
  }
});

test('CN9 scope remains frozen to Creator Network runtime, tests and docs', async () => {
  const spec = await source(SPEC);

  assert.match(spec, /CN9 não altera mobile/);
  assert.match(spec, /Product Entitlements/);
  assert.match(spec, /Equipment/);
  assert.match(spec, /Aggregator/);
  assert.match(spec, /Student Finance/);
  assert.match(spec, /a execução deve parar/);
});
