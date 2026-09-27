-- IRON Commercial Readiness — Macro B Launch Capability Matrix authority.

CREATE TYPE "CommercialLaunchMatrixStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');
CREATE TYPE "CommercialLaunchDecision" AS ENUM ('UNDECIDED', 'LAUNCH', 'EXTERNAL_BLOCKER', 'OUT');
CREATE TYPE "CommercialLaunchItemKind" AS ENUM ('SURFACE', 'CHANNEL', 'PROVIDER', 'CAPABILITY', 'MOBILE');
CREATE TYPE "CommercialUpgradePolicy" AS ENUM ('IMMEDIATE_PRORATED');
CREATE TYPE "CommercialDowngradePolicy" AS ENUM ('NEXT_PERIOD_NO_IMMEDIATE_REFUND');
CREATE TYPE "CommercialCancellationPolicy" AS ENUM ('IMMEDIATE_OR_PERIOD_END');
CREATE TYPE "CommercialRefundPolicy" AS ENUM ('SUPER_ADMIN_MANUAL');
CREATE TYPE "CommercialFiscalMode" AS ENUM ('UNDECIDED', 'PROVIDER_NFSE', 'EXTERNAL_HANDOFF', 'OUT');

CREATE TABLE "CommercialLaunchMatrix" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "status" "CommercialLaunchMatrixStatus" NOT NULL DEFAULT 'DRAFT',
  "snapshotHash" TEXT,
  "createdByUserId" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommercialLaunchMatrix_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialLaunchMatrix_version_positive" CHECK ("version" > 0),
  CONSTRAINT "CommercialLaunchMatrix_name_length" CHECK (char_length("name") BETWEEN 3 AND 120),
  CONSTRAINT "CommercialLaunchMatrix_snapshot_hash" CHECK (
    "snapshotHash" IS NULL OR "snapshotHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "CommercialLaunchMatrix_approval_shape" CHECK (
    ("status" = 'DRAFT' AND "approvedAt" IS NULL AND "approvedByUserId" IS NULL AND "snapshotHash" IS NULL AND "retiredAt" IS NULL)
    OR
    ("status" = 'APPROVED' AND "approvedAt" IS NOT NULL AND "approvedByUserId" IS NOT NULL AND "snapshotHash" IS NOT NULL AND "retiredAt" IS NULL)
    OR
    ("status" = 'RETIRED' AND "approvedAt" IS NOT NULL AND "approvedByUserId" IS NOT NULL AND "snapshotHash" IS NOT NULL AND "retiredAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "CommercialLaunchMatrix_version_key"
  ON "CommercialLaunchMatrix"("version");
CREATE UNIQUE INDEX "CommercialLaunchMatrix_one_approved"
  ON "CommercialLaunchMatrix"("status") WHERE "status" = 'APPROVED';
CREATE INDEX "CommercialLaunchMatrix_status_approvedAt_idx"
  ON "CommercialLaunchMatrix"("status", "approvedAt");

CREATE TABLE "CommercialLaunchItem" (
  "id" TEXT NOT NULL,
  "matrixId" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "kind" "CommercialLaunchItemKind" NOT NULL,
  "decision" "CommercialLaunchDecision" NOT NULL DEFAULT 'UNDECIDED',
  "featureKey" TEXT,
  "rationale" TEXT,
  "blockerOwner" TEXT,
  "evidenceRequirement" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommercialLaunchItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialLaunchItem_key" CHECK (
    "itemKey" ~ '^[a-z][a-z0-9._-]{2,95}$'
  ),
  CONSTRAINT "CommercialLaunchItem_feature_key" CHECK (
    "featureKey" IS NULL OR "featureKey" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
  ),
  CONSTRAINT "CommercialLaunchItem_rationale_length" CHECK (
    "rationale" IS NULL OR char_length("rationale") BETWEEN 3 AND 1000
  )
);

CREATE UNIQUE INDEX "CommercialLaunchItem_matrixId_itemKey_key"
  ON "CommercialLaunchItem"("matrixId", "itemKey");
CREATE INDEX "CommercialLaunchItem_matrixId_decision_idx"
  ON "CommercialLaunchItem"("matrixId", "decision");
CREATE INDEX "CommercialLaunchItem_featureKey_idx"
  ON "CommercialLaunchItem"("featureKey");

CREATE TABLE "CommercialLaunchOffering" (
  "id" TEXT NOT NULL,
  "matrixId" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "priceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialLaunchOffering_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommercialLaunchOffering_matrixId_priceId_key"
  ON "CommercialLaunchOffering"("matrixId", "priceId");
CREATE INDEX "CommercialLaunchOffering_matrixId_planVersionId_idx"
  ON "CommercialLaunchOffering"("matrixId", "planVersionId");

CREATE TABLE "CommercialLaunchPolicy" (
  "id" TEXT NOT NULL,
  "matrixId" TEXT NOT NULL,
  "trialEnabled" BOOLEAN NOT NULL,
  "trialPlanVersionId" TEXT,
  "trialDays" INTEGER,
  "invoiceDueDays" INTEGER,
  "dunningGraceDays" INTEGER,
  "upgradePolicy" "CommercialUpgradePolicy",
  "downgradePolicy" "CommercialDowngradePolicy",
  "cancellationPolicy" "CommercialCancellationPolicy",
  "refundPolicy" "CommercialRefundPolicy",
  "fiscalMode" "CommercialFiscalMode" NOT NULL DEFAULT 'UNDECIDED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommercialLaunchPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialLaunchPolicy_trial_shape" CHECK (
    ("trialEnabled" = TRUE AND "trialPlanVersionId" IS NOT NULL AND "trialDays" BETWEEN 1 AND 90)
    OR
    ("trialEnabled" = FALSE AND "trialPlanVersionId" IS NULL AND "trialDays" IS NULL)
  ),
  CONSTRAINT "CommercialLaunchPolicy_invoice_due_days" CHECK (
    "invoiceDueDays" IS NULL OR "invoiceDueDays" BETWEEN 0 AND 30
  ),
  CONSTRAINT "CommercialLaunchPolicy_dunning_grace_days" CHECK (
    "dunningGraceDays" IS NULL OR "dunningGraceDays" BETWEEN 1 AND 30
  )
);

CREATE UNIQUE INDEX "CommercialLaunchPolicy_matrixId_key"
  ON "CommercialLaunchPolicy"("matrixId");

ALTER TABLE "CommercialLaunchItem"
  ADD CONSTRAINT "CommercialLaunchItem_matrixId_fkey"
  FOREIGN KEY ("matrixId") REFERENCES "CommercialLaunchMatrix"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommercialLaunchItem"
  ADD CONSTRAINT "CommercialLaunchItem_featureKey_fkey"
  FOREIGN KEY ("featureKey") REFERENCES "ProductCapabilityDefinition"("key")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CommercialLaunchOffering"
  ADD CONSTRAINT "CommercialLaunchOffering_matrixId_fkey"
  FOREIGN KEY ("matrixId") REFERENCES "CommercialLaunchMatrix"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommercialLaunchOffering"
  ADD CONSTRAINT "CommercialLaunchOffering_planVersionId_fkey"
  FOREIGN KEY ("planVersionId") REFERENCES "ProductPlanVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercialLaunchOffering"
  ADD CONSTRAINT "CommercialLaunchOffering_priceId_fkey"
  FOREIGN KEY ("priceId") REFERENCES "SaasPlanPrice"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercialLaunchPolicy"
  ADD CONSTRAINT "CommercialLaunchPolicy_matrixId_fkey"
  FOREIGN KEY ("matrixId") REFERENCES "CommercialLaunchMatrix"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommercialLaunchPolicy"
  ADD CONSTRAINT "CommercialLaunchPolicy_trialPlanVersionId_fkey"
  FOREIGN KEY ("trialPlanVersionId") REFERENCES "ProductPlanVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercialLaunchMatrix"
  ADD CONSTRAINT "CommercialLaunchMatrix_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommercialLaunchMatrix"
  ADD CONSTRAINT "CommercialLaunchMatrix_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
