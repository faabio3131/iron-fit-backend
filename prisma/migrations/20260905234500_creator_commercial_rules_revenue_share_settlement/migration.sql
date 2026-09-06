CREATE TYPE "CreatorCommercialRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'REVOKED');
CREATE TYPE "CreatorCompensationMode" AS ENUM ('FIXED_PER_EVENT', 'REVENUE_SHARE_BPS');
CREATE TYPE "CreatorSettlementStatus" AS ENUM ('FINALIZED', 'SETTLED');

CREATE TABLE "CreatorCommercialAgreement" (
  "id" TEXT NOT NULL,
  "scope" "CreatorRightsScope" NOT NULL,
  "gymId" TEXT,
  "contentId" TEXT NOT NULL,
  "beneficiaryRightsHolderId" TEXT NOT NULL,
  "beneficiaryLegalName" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreatorCommercialAgreement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorCommercialRuleVersion" (
  "id" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "CreatorCommercialRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "compensationMode" "CreatorCompensationMode" NOT NULL,
  "qualifyingEventType" "CreatorUsageEventType" NOT NULL,
  "fixedAmountMinor" INTEGER,
  "revenueShareBps" INTEGER,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "termsReference" TEXT NOT NULL,
  "termsSha256" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreatorCommercialRuleVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorCommercialAccrual" (
  "id" TEXT NOT NULL,
  "scope" "CreatorRightsScope" NOT NULL,
  "gymId" TEXT,
  "consumptionGymId" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "ruleVersionId" TEXT NOT NULL,
  "usageSessionId" TEXT NOT NULL,
  "usageEventId" TEXT NOT NULL,
  "usageObservationSource" "CreatorUsageObservationSource" NOT NULL,
  "attributionSnapshotId" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "contentVersionId" TEXT NOT NULL,
  "beneficiaryRightsHolderId" TEXT NOT NULL,
  "beneficiaryLegalName" TEXT NOT NULL,
  "compensationMode" "CreatorCompensationMode" NOT NULL,
  "qualifyingEventType" "CreatorUsageEventType" NOT NULL,
  "currency" TEXT NOT NULL,
  "fixedAmountMinor" INTEGER,
  "eligibleRevenueMinor" INTEGER,
  "revenueShareBps" INTEGER,
  "revenueSourceType" TEXT,
  "revenueSourceId" TEXT,
  "revenueEvidenceSha256" TEXT,
  "amountMinor" INTEGER NOT NULL,
  "sourceEventObservedAt" TIMESTAMP(3) NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "accruedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreatorCommercialAccrual_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorSettlementBatch" (
  "id" TEXT NOT NULL,
  "scope" "CreatorRightsScope" NOT NULL,
  "gymId" TEXT,
  "beneficiaryRightsHolderId" TEXT NOT NULL,
  "beneficiaryLegalName" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "settlementKey" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" "CreatorSettlementStatus" NOT NULL DEFAULT 'FINALIZED',
  "accrualCount" INTEGER NOT NULL,
  "totalAmountMinor" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  "settlementProvider" TEXT,
  "externalSettlementId" TEXT,
  "settlementEvidenceSha256" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreatorSettlementBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorSettlementItem" (
  "id" TEXT NOT NULL,
  "settlementBatchId" TEXT NOT NULL,
  "accrualId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreatorSettlementItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreatorCommercialAgreement_fingerprint_key" ON "CreatorCommercialAgreement"("fingerprint");
CREATE INDEX "CreatorCommercialAgreement_scope_content_idx" ON "CreatorCommercialAgreement"("scope", "gymId", "contentId");
CREATE INDEX "CreatorCommercialAgreement_beneficiary_currency_idx" ON "CreatorCommercialAgreement"("beneficiaryRightsHolderId", "currency");

CREATE UNIQUE INDEX "CreatorCommercialRuleVersion_fingerprint_key" ON "CreatorCommercialRuleVersion"("fingerprint");
CREATE UNIQUE INDEX "CreatorCommercialRuleVersion_agreement_version_key" ON "CreatorCommercialRuleVersion"("agreementId", "version");
CREATE INDEX "CreatorCommercialRuleVersion_agreement_status_idx" ON "CreatorCommercialRuleVersion"("agreementId", "status", "version");
CREATE INDEX "CreatorCommercialRuleVersion_event_status_idx" ON "CreatorCommercialRuleVersion"("qualifyingEventType", "status");
CREATE UNIQUE INDEX "CN8_one_draft_rule_per_agreement_uq" ON "CreatorCommercialRuleVersion"("agreementId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "CN8_one_active_rule_per_agreement_uq" ON "CreatorCommercialRuleVersion"("agreementId") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "CreatorCommercialAccrual_fingerprint_key" ON "CreatorCommercialAccrual"("fingerprint");
CREATE UNIQUE INDEX "CreatorCommercialAccrual_rule_event_key" ON "CreatorCommercialAccrual"("ruleVersionId", "usageEventId");
CREATE INDEX "CreatorCommercialAccrual_beneficiary_period_idx" ON "CreatorCommercialAccrual"("scope", "gymId", "beneficiaryRightsHolderId", "currency", "sourceEventObservedAt");
CREATE INDEX "CreatorCommercialAccrual_consumption_gym_idx" ON "CreatorCommercialAccrual"("consumptionGymId", "sourceEventObservedAt");
CREATE INDEX "CreatorCommercialAccrual_usage_session_idx" ON "CreatorCommercialAccrual"("usageSessionId");
CREATE INDEX "CreatorCommercialAccrual_usage_event_idx" ON "CreatorCommercialAccrual"("usageEventId");
CREATE INDEX "CreatorCommercialAccrual_content_idx" ON "CreatorCommercialAccrual"("contentId", "sourceEventObservedAt");

CREATE UNIQUE INDEX "CreatorSettlementBatch_fingerprint_key" ON "CreatorSettlementBatch"("fingerprint");
CREATE UNIQUE INDEX "CN8_settlement_scope_key_uq" ON "CreatorSettlementBatch"("scope", COALESCE("gymId", '__GLOBAL__'), "settlementKey");
CREATE INDEX "CreatorSettlementBatch_beneficiary_period_idx" ON "CreatorSettlementBatch"("scope", "gymId", "beneficiaryRightsHolderId", "currency", "periodStart", "periodEnd");
CREATE INDEX "CreatorSettlementBatch_status_finalized_idx" ON "CreatorSettlementBatch"("status", "finalizedAt");
CREATE UNIQUE INDEX "CN8_external_settlement_reference_uq" ON "CreatorSettlementBatch"("settlementProvider", "externalSettlementId") WHERE "status" = 'SETTLED';

CREATE UNIQUE INDEX "CreatorSettlementItem_accrualId_key" ON "CreatorSettlementItem"("accrualId");
CREATE UNIQUE INDEX "CreatorSettlementItem_fingerprint_key" ON "CreatorSettlementItem"("fingerprint");
CREATE INDEX "CreatorSettlementItem_batch_idx" ON "CreatorSettlementItem"("settlementBatchId");

ALTER TABLE "CreatorCommercialAgreement" ADD CONSTRAINT "CN8_agreement_scope_check" CHECK (("scope" = 'GLOBAL' AND "gymId" IS NULL) OR ("scope" = 'TENANT' AND "gymId" IS NOT NULL));
ALTER TABLE "CreatorCommercialAgreement" ADD CONSTRAINT "CN8_agreement_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "CreatorCommercialAgreement" ADD CONSTRAINT "CN8_agreement_beneficiary_name_check" CHECK (length(btrim("beneficiaryLegalName")) > 0);
ALTER TABLE "CreatorCommercialAgreement" ADD CONSTRAINT "CN8_agreement_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "CreatorCommercialRuleVersion" ADD CONSTRAINT "CN8_rule_version_positive_check" CHECK ("version" > 0);
ALTER TABLE "CreatorCommercialRuleVersion" ADD CONSTRAINT "CN8_rule_event_check" CHECK ("qualifyingEventType" IN ('DELIVERY_RESOLVED', 'CONTENT_OPENED', 'CONTENT_COMPLETED'));
ALTER TABLE "CreatorCommercialRuleVersion" ADD CONSTRAINT "CN8_rule_validity_check" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom");
ALTER TABLE "CreatorCommercialRuleVersion" ADD CONSTRAINT "CN8_rule_terms_reference_check" CHECK (length(btrim("termsReference")) >= 3);
ALTER TABLE "CreatorCommercialRuleVersion" ADD CONSTRAINT "CN8_rule_terms_hash_check" CHECK ("termsSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "CreatorCommercialRuleVersion" ADD CONSTRAINT "CN8_rule_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');
ALTER TABLE "CreatorCommercialRuleVersion" ADD CONSTRAINT "CN8_rule_compensation_shape_check" CHECK (("compensationMode" = 'FIXED_PER_EVENT' AND "fixedAmountMinor" IS NOT NULL AND "fixedAmountMinor" > 0 AND "revenueShareBps" IS NULL) OR ("compensationMode" = 'REVENUE_SHARE_BPS' AND "fixedAmountMinor" IS NULL AND "revenueShareBps" BETWEEN 1 AND 10000));

ALTER TABLE "CreatorCommercialAccrual" ADD CONSTRAINT "CN8_accrual_scope_check" CHECK (("scope" = 'GLOBAL' AND "gymId" IS NULL) OR ("scope" = 'TENANT' AND "gymId" IS NOT NULL));
ALTER TABLE "CreatorCommercialAccrual" ADD CONSTRAINT "CN8_accrual_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "CreatorCommercialAccrual" ADD CONSTRAINT "CN8_accrual_amount_check" CHECK ("amountMinor" >= 0);
ALTER TABLE "CreatorCommercialAccrual" ADD CONSTRAINT "CN8_accrual_event_check" CHECK ("qualifyingEventType" IN ('DELIVERY_RESOLVED', 'CONTENT_OPENED', 'CONTENT_COMPLETED'));
ALTER TABLE "CreatorCommercialAccrual" ADD CONSTRAINT "CN8_accrual_beneficiary_name_check" CHECK (length(btrim("beneficiaryLegalName")) > 0);
ALTER TABLE "CreatorCommercialAccrual" ADD CONSTRAINT "CN8_accrual_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');
ALTER TABLE "CreatorCommercialAccrual" ADD CONSTRAINT "CN8_accrual_compensation_shape_check" CHECK (("compensationMode" = 'FIXED_PER_EVENT' AND "fixedAmountMinor" IS NOT NULL AND "fixedAmountMinor" > 0 AND "eligibleRevenueMinor" IS NULL AND "revenueShareBps" IS NULL AND "revenueSourceType" IS NULL AND "revenueSourceId" IS NULL AND "revenueEvidenceSha256" IS NULL AND "amountMinor" = "fixedAmountMinor") OR ("compensationMode" = 'REVENUE_SHARE_BPS' AND "fixedAmountMinor" IS NULL AND "eligibleRevenueMinor" IS NOT NULL AND "eligibleRevenueMinor" >= 0 AND "revenueShareBps" BETWEEN 1 AND 10000 AND "revenueSourceType" IS NOT NULL AND length(btrim("revenueSourceType")) > 0 AND "revenueSourceId" IS NOT NULL AND length(btrim("revenueSourceId")) > 0 AND "revenueEvidenceSha256" ~ '^[0-9a-f]{64}$' AND "amountMinor" = floor(("eligibleRevenueMinor"::numeric * "revenueShareBps"::numeric) / 10000)::integer));

ALTER TABLE "CreatorSettlementBatch" ADD CONSTRAINT "CN8_settlement_scope_check" CHECK (("scope" = 'GLOBAL' AND "gymId" IS NULL) OR ("scope" = 'TENANT' AND "gymId" IS NOT NULL));
ALTER TABLE "CreatorSettlementBatch" ADD CONSTRAINT "CN8_settlement_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "CreatorSettlementBatch" ADD CONSTRAINT "CN8_settlement_key_uuid_check" CHECK ("settlementKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
ALTER TABLE "CreatorSettlementBatch" ADD CONSTRAINT "CN8_settlement_period_check" CHECK ("periodEnd" > "periodStart");
ALTER TABLE "CreatorSettlementBatch" ADD CONSTRAINT "CN8_settlement_totals_check" CHECK ("accrualCount" > 0 AND "totalAmountMinor" > 0);
ALTER TABLE "CreatorSettlementBatch" ADD CONSTRAINT "CN8_settlement_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');
ALTER TABLE "CreatorSettlementBatch" ADD CONSTRAINT "CN8_settlement_evidence_shape_check" CHECK (("status" = 'FINALIZED' AND "settledAt" IS NULL AND "settlementProvider" IS NULL AND "externalSettlementId" IS NULL AND "settlementEvidenceSha256" IS NULL) OR ("status" = 'SETTLED' AND "settledAt" IS NOT NULL AND "settlementProvider" IS NOT NULL AND length(btrim("settlementProvider")) > 0 AND "externalSettlementId" IS NOT NULL AND length(btrim("externalSettlementId")) > 0 AND "settlementEvidenceSha256" ~ '^[0-9a-f]{64}$'));

ALTER TABLE "CreatorSettlementItem" ADD CONSTRAINT "CN8_settlement_item_amount_check" CHECK ("amountMinor" > 0);
ALTER TABLE "CreatorSettlementItem" ADD CONSTRAINT "CN8_settlement_item_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "CreatorCommercialRuleVersion" ADD CONSTRAINT "CreatorCommercialRuleVersion_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CreatorCommercialAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorCommercialAccrual" ADD CONSTRAINT "CreatorCommercialAccrual_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CreatorCommercialAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorCommercialAccrual" ADD CONSTRAINT "CreatorCommercialAccrual_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "CreatorCommercialRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorSettlementItem" ADD CONSTRAINT "CreatorSettlementItem_batchId_fkey" FOREIGN KEY ("settlementBatchId") REFERENCES "CreatorSettlementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorSettlementItem" ADD CONSTRAINT "CreatorSettlementItem_accrualId_fkey" FOREIGN KEY ("accrualId") REFERENCES "CreatorCommercialAccrual"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION cn8_reject_append_only_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CN8 append-only record cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cn8_rule_version_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CN8 rule versions cannot be deleted';
  END IF;

  IF ROW(NEW."agreementId", NEW."version", NEW."compensationMode", NEW."qualifyingEventType", NEW."fixedAmountMinor", NEW."revenueShareBps", NEW."effectiveFrom", NEW."effectiveUntil", NEW."termsReference", NEW."termsSha256", NEW."fingerprint")
     IS DISTINCT FROM
     ROW(OLD."agreementId", OLD."version", OLD."compensationMode", OLD."qualifyingEventType", OLD."fixedAmountMinor", OLD."revenueShareBps", OLD."effectiveFrom", OLD."effectiveUntil", OLD."termsReference", OLD."termsSha256", OLD."fingerprint") THEN
    RAISE EXCEPTION 'CN8 rule terms are immutable; create a new version';
  END IF;

  IF OLD."status" IN ('SUPERSEDED', 'REVOKED') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'CN8 terminal rule status cannot transition';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'ACTIVE', 'REVOKED') THEN
    RAISE EXCEPTION 'CN8 invalid DRAFT rule transition';
  END IF;
  IF OLD."status" = 'ACTIVE' AND NEW."status" NOT IN ('ACTIVE', 'SUPERSEDED', 'REVOKED') THEN
    RAISE EXCEPTION 'CN8 invalid ACTIVE rule transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cn8_settlement_batch_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CN8 settlement batches cannot be deleted';
  END IF;
  IF ROW(NEW."scope", NEW."gymId", NEW."beneficiaryRightsHolderId", NEW."beneficiaryLegalName", NEW."currency", NEW."settlementKey", NEW."periodStart", NEW."periodEnd", NEW."accrualCount", NEW."totalAmountMinor", NEW."fingerprint", NEW."finalizedAt")
     IS DISTINCT FROM
     ROW(OLD."scope", OLD."gymId", OLD."beneficiaryRightsHolderId", OLD."beneficiaryLegalName", OLD."currency", OLD."settlementKey", OLD."periodStart", OLD."periodEnd", OLD."accrualCount", OLD."totalAmountMinor", OLD."fingerprint", OLD."finalizedAt") THEN
    RAISE EXCEPTION 'CN8 finalized settlement facts are immutable';
  END IF;
  IF OLD."status" = 'SETTLED' AND ROW(NEW."status", NEW."settledAt", NEW."settlementProvider", NEW."externalSettlementId", NEW."settlementEvidenceSha256") IS DISTINCT FROM ROW(OLD."status", OLD."settledAt", OLD."settlementProvider", OLD."externalSettlementId", OLD."settlementEvidenceSha256") THEN
    RAISE EXCEPTION 'CN8 SETTLED batch is terminal';
  END IF;
  IF OLD."status" = 'FINALIZED' AND NEW."status" NOT IN ('FINALIZED', 'SETTLED') THEN
    RAISE EXCEPTION 'CN8 invalid settlement transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CN8_agreement_append_only_trigger" BEFORE UPDATE OR DELETE ON "CreatorCommercialAgreement" FOR EACH ROW EXECUTE FUNCTION cn8_reject_append_only_mutation();
CREATE TRIGGER "CN8_rule_version_guard_trigger" BEFORE UPDATE OR DELETE ON "CreatorCommercialRuleVersion" FOR EACH ROW EXECUTE FUNCTION cn8_rule_version_guard();
CREATE TRIGGER "CN8_accrual_append_only_trigger" BEFORE UPDATE OR DELETE ON "CreatorCommercialAccrual" FOR EACH ROW EXECUTE FUNCTION cn8_reject_append_only_mutation();
CREATE TRIGGER "CN8_settlement_item_append_only_trigger" BEFORE UPDATE OR DELETE ON "CreatorSettlementItem" FOR EACH ROW EXECUTE FUNCTION cn8_reject_append_only_mutation();
CREATE TRIGGER "CN8_settlement_batch_guard_trigger" BEFORE UPDATE OR DELETE ON "CreatorSettlementBatch" FOR EACH ROW EXECUTE FUNCTION cn8_settlement_batch_guard();
