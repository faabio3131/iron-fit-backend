import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DOMAIN = 'prisma/creator-commercial.prisma';
const MIGRATION =
  'prisma/migrations/20260905234500_creator_commercial_rules_revenue_share_settlement/migration.sql';
const DTO = 'src/modules/creator-network/dto/creator-commercial.dto.ts';
const SERVICE = 'src/modules/creator-network/creator-commercial.service.ts';
const CONTROLLER = 'src/modules/creator-network/creator-commercial.controller.ts';
const MODULE = 'src/modules/creator-network/creator-network.module.ts';
const DOC = 'docs/CN8_COMMERCIAL_RULES_REVENUE_SHARE_SETTLEMENT.md';

async function source(path) {
  return readFile(path, 'utf8');
}

function model(domain, name) {
  return domain.match(new RegExp(`model ${name}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
}

test('CN8 materializes agreement, versioned commercial rules, accruals and settlement ledger', async () => {
  const domain = await source(DOMAIN);
  for (const name of [
    'CreatorCommercialAgreement',
    'CreatorCommercialRuleVersion',
    'CreatorCommercialAccrual',
    'CreatorSettlementBatch',
    'CreatorSettlementItem',
  ]) {
    assert.ok(model(domain, name), `${name} must exist`);
  }
  assert.match(domain, /FIXED_PER_EVENT/);
  assert.match(domain, /REVENUE_SHARE_BPS/);
  assert.match(domain, /FINALIZED[\s\S]*SETTLED/);
});

test('CN8 commercial ledger remains physically separate from gym finance, student billing and Aggregator settlement', async () => {
  const domain = await source(DOMAIN);
  const migration = await source(MIGRATION);
  const service = await source(SERVICE);

  assert.doesNotMatch(domain, /FinancialTransaction|\bPayable\b|\bCharge\b|\bSubscription\b|AggregatorSettlement/);
  assert.doesNotMatch(service, /financialTransaction|\.payable|\.charge|\.subscription|aggregatorSettlement/i);
  assert.doesNotMatch(migration, /ALTER TABLE "(?:FinancialTransaction|Payable|Charge|Subscription|AggregatorSettlement|ProductPlan|ProductPlanVersion|TenantProductSubscription)"/);
});

test('CN8 agreement beneficiary is the ACTIVE Rights Holder with effective rights and required consent', async () => {
  const service = await source(SERVICE);

  assert.match(service, /CreatorRightsGrantStatus\.ACTIVE/);
  assert.match(service, /CreatorRightsHolderStatus\.ACTIVE/);
  assert.match(service, /CreatorRightsConsentStatus\.ACTIVE/);
  assert.match(service, /activeRights\.rightsHolderId !== dto\.beneficiaryRightsHolderId/);
  assert.match(service, /Beneficiario comercial deve ser o Rights Holder ACTIVE do conteudo/);
});

test('CN8 API derives GLOBAL or TENANT authority from authentication and DTO never accepts gymId', async () => {
  const controller = await source(CONTROLLER);
  const dto = await source(DTO);

  assert.match(controller, /Commercial GLOBAL exige SUPER_ADMIN/);
  assert.match(controller, /Commercial TENANT exige OWNER\/MANAGER com tenant autenticado/);
  assert.match(controller, /user\.activeGymId/);
  assert.match(controller, /user\.isSuperAdmin/);
  assert.doesNotMatch(dto, /gymId|activeGymId|userId/);
});

test('CN8 migration physically enforces one DRAFT and one ACTIVE rule per agreement', async () => {
  const migration = await source(MIGRATION);
  assert.match(migration, /CN8_one_draft_rule_per_agreement_uq/);
  assert.match(migration, /CN8_one_active_rule_per_agreement_uq/);
  assert.match(migration, /WHERE "status" = 'DRAFT'/);
  assert.match(migration, /WHERE "status" = 'ACTIVE'/);
});

test('CN8 rule terms are immutable and lifecycle transitions are guarded in PostgreSQL', async () => {
  const migration = await source(MIGRATION);
  const service = await source(SERVICE);

  assert.match(migration, /cn8_rule_version_guard/);
  assert.match(migration, /rule terms are immutable; create a new version/);
  assert.match(service, /CreatorCommercialRuleStatus\.SUPERSEDED/);
  assert.match(service, /CreatorCommercialRuleStatus\.REVOKED/);
  assert.doesNotMatch(service, /fixedAmountMinor:\s*dto\.fixedAmountMinor[\s\S]{0,120}update\(/);
});

test('CN8 activation rejects future and expired rules and historical accrual requires rule activated before event', async () => {
  const service = await source(SERVICE);

  assert.match(service, /Rule futura deve permanecer DRAFT ate effectiveFrom/);
  assert.match(service, /Rule ja expirou e nao pode ser ativada/);
  assert.match(service, /observedAt < rule\.effectiveFrom \|\| observedAt < rule\.activatedAt/);
  assert.match(service, /rule\.supersededAt && observedAt >= rule\.supersededAt/);
  assert.match(service, /rule\.revokedAt && observedAt >= rule\.revokedAt/);
});

test('CN8 qualifying commercial events exclude repeatable progress and dismissed signals', async () => {
  const dto = await source(DTO);
  const migration = await source(MIGRATION);

  assert.match(dto, /DELIVERY_RESOLVED/);
  assert.match(dto, /CONTENT_OPENED/);
  assert.match(dto, /CONTENT_COMPLETED/);
  assert.doesNotMatch(dto, /CONTENT_PROGRESS|CONTENT_DISMISSED/);
  assert.match(migration, /CN8_rule_event_check/);
});

test('CN8 FIXED_PER_EVENT is exact and refuses hidden revenue inputs', async () => {
  const service = await source(SERVICE);
  const migration = await source(MIGRATION);

  assert.match(service, /FIXED_PER_EVENT nao aceita base de receita externa/);
  assert.match(service, /amountMinor: rule\.fixedAmountMinor/);
  assert.match(migration, /"amountMinor" = "fixedAmountMinor"/);
});

test('CN8 REVENUE_SHARE_BPS requires explicit revenue provenance and deterministic basis-point calculation', async () => {
  const service = await source(SERVICE);
  const migration = await source(MIGRATION);

  assert.match(service, /REVENUE_SHARE_BPS exige receita elegivel e proveniencia completa/);
  assert.match(service, /eligibleRevenueMinor \* rule\.revenueShareBps/);
  assert.match(service, /\/ 10000/);
  assert.match(migration, /"revenueEvidenceSha256" ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /floor\(\("eligibleRevenueMinor"::numeric \* "revenueShareBps"::numeric\) \/ 10000\)/);
});

test('CN8 never infers eligible revenue from internal finance or aggregator domains', async () => {
  const docs = await source(DOC);
  const service = await source(SERVICE);

  assert.match(docs, /base monetária não é inferida automaticamente|base monetária não é inferida/i);
  assert.match(docs, /FinancialTransaction/);
  assert.match(docs, /AggregatorSettlement/);
  assert.doesNotMatch(service, /amountConfirmed|gatewayChargeId|sourceId.*FinancialTransaction/i);
});

test('CN8 accrual accepts only CN7 MANAGED_CONTENT with coherent attribution Rights Holder', async () => {
  const service = await source(SERVICE);

  assert.match(service, /CreatorUsageDeliveryKind\.MANAGED_CONTENT/);
  assert.match(service, /session\.attributionSnapshot/);
  assert.match(service, /attribution\.contentVersionId !== session\.contentVersionId/);
  assert.match(service, /attribution\.rightsHolderId !== agreement\.beneficiaryRightsHolderId/);
});

test('CN8 tenant accrual cannot consume a CN7 event from another gym while GLOBAL preserves consumptionGymId', async () => {
  const service = await source(SERVICE);
  const domain = await source(DOMAIN);

  assert.match(service, /context\.scope === CreatorRightsScope\.TENANT[\s\S]*session\.gymId !== context\.gymId/);
  assert.match(service, /consumptionGymId: session\.gymId/);
  assert.match(model(domain, 'CreatorCommercialAccrual'), /consumptionGymId\s+String/);
});

test('CN8 accrual is physically unique per commercial rule and CN7 usage event with exact replay only', async () => {
  const domain = await source(DOMAIN);
  const service = await source(SERVICE);

  assert.match(domain, /@@unique\(\[ruleVersionId, usageEventId\]\)/);
  assert.match(service, /ruleVersionId_usageEventId/);
  assert.match(service, /existing\.fingerprint === fingerprint/);
  assert.match(service, /Evento CN7 ja possui accrual divergente/);
});

test('CN8 agreement, accrual and settlement items are append-only at database level', async () => {
  const migration = await source(MIGRATION);

  assert.match(migration, /CN8_agreement_append_only_trigger/);
  assert.match(migration, /CN8_accrual_append_only_trigger/);
  assert.match(migration, /CN8_settlement_item_append_only_trigger/);
  assert.match(migration, /cn8_reject_append_only_mutation/);
});

test('CN8 settlement collects only positive unassigned accruals in scope beneficiary currency and period', async () => {
  const service = await source(SERVICE);

  assert.match(service, /beneficiaryRightsHolderId: beneficiary\.id/);
  assert.match(service, /sourceEventObservedAt: \{ gte: periodStart, lt: periodEnd \}/);
  assert.match(service, /amountMinor: \{ gt: 0 \}/);
  assert.match(service, /candidates\.filter\(\(item\) => !item\.settlementItem\)/);
});

test('CN8 settlement is idempotent by settlementKey and each accrual can belong to one settlement only', async () => {
  const domain = await source(DOMAIN);
  const migration = await source(MIGRATION);
  const service = await source(SERVICE);

  assert.match(model(domain, 'CreatorSettlementBatch'), /settlementKey\s+String/);
  assert.match(model(domain, 'CreatorSettlementItem'), /accrualId\s+String\s+@unique/);
  assert.match(migration, /CN8_settlement_scope_key_uq/);
  assert.match(service, /settlementKey ja utilizado com parametros divergentes/);
});

test('CN8 SETTLED requires external evidence and is an attestation rather than a payment execution', async () => {
  const service = await source(SERVICE);
  const migration = await source(MIGRATION);
  const docs = await source(DOC);

  assert.match(service, /settlementEvidenceSha256/);
  assert.match(service, /paymentExecutionByIron: false/);
  assert.match(migration, /CN8_external_settlement_reference_uq/);
  assert.match(migration, /CN8_settlement_evidence_shape_check/);
  assert.match(docs, /não chama banco, PIX, gateway ou provider financeiro/i);
});

test('CN8 SETTLED batches are terminal and finalized settlement facts cannot mutate', async () => {
  const migration = await source(MIGRATION);

  assert.match(migration, /cn8_settlement_batch_guard/);
  assert.match(migration, /finalized settlement facts are immutable/);
  assert.match(migration, /CN8 SETTLED batch is terminal/);
});

test('CN8 mutations are Serializable, retry known conflicts and atomically audit commercial transitions', async () => {
  const service = await source(SERVICE);

  assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(service, /error\.code === 'P2034' \|\| error\.code === 'P2002'/);
  for (const action of [
    'CREATOR_COMMERCIAL_AGREEMENT_REGISTERED',
    'CREATOR_COMMERCIAL_RULE_VERSION_CREATED',
    'CREATOR_COMMERCIAL_RULE_ACTIVATED',
    'CREATOR_COMMERCIAL_RULE_REVOKED',
    'CREATOR_COMMERCIAL_ACCRUAL_RECORDED',
    'CREATOR_SETTLEMENT_FINALIZED',
    'CREATOR_SETTLEMENT_SETTLED_ATTESTED',
  ]) {
    assert.match(service, new RegExp(action));
  }
});

test('CN8 module is wired while CN9 analytics and AI remain outside implementation', async () => {
  const module = await source(MODULE);
  const service = await source(SERVICE);
  const controller = await source(CONTROLLER);
  const docs = await source(DOC);

  assert.match(module, /CreatorCommercialController/);
  assert.match(module, /CreatorCommercialService/);
  assert.match(docs, /IRON-CN9 — Operational Console \+ Analytics \+ Full Creator Network Certification/);
  assert.doesNotMatch(`${service}\n${controller}`, /dashboard|forecast|recommendation|openai|\bllm\b|machine learning/i);
});
