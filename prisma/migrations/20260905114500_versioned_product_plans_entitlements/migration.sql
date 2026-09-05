-- IRON-PE1 — Versioned Product Plans + Entitlements
-- Additive global SaaS product catalog. Does not alter Gym or student financial Subscription.

CREATE TYPE "ProductPlanVersionStatus" AS ENUM (
  'DRAFT',
  'PUBLISHED',
  'RETIRED'
);

CREATE TYPE "ProductEntitlementKind" AS ENUM (
  'FEATURE',
  'LIMIT',
  'POLICY'
);

CREATE TABLE "ProductPlan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductPlanVersion" (
  "id" TEXT NOT NULL,
  "productPlanId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ProductPlanVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductPlanVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductPlanVersion_version_positive" CHECK ("version" > 0)
);

CREATE TABLE "ProductPlanEntitlement" (
  "id" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "kind" "ProductEntitlementKind" NOT NULL,
  "featureEnabled" BOOLEAN,
  "limitValue" INTEGER,
  "policyValues" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductPlanEntitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductPlanEntitlement_value_shape" CHECK (
    ("kind" = 'FEATURE' AND "featureEnabled" IS NOT NULL AND "limitValue" IS NULL AND "policyValues" IS NULL)
    OR
    ("kind" = 'LIMIT' AND "featureEnabled" IS NULL AND "limitValue" IS NOT NULL AND "limitValue" >= 0 AND "policyValues" IS NULL)
    OR
    ("kind" = 'POLICY' AND "featureEnabled" IS NULL AND "limitValue" IS NULL AND "policyValues" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ProductPlan_code_key"
  ON "ProductPlan"("code");

CREATE UNIQUE INDEX "ProductPlanVersion_productPlanId_version_key"
  ON "ProductPlanVersion"("productPlanId", "version");

CREATE INDEX "ProductPlanVersion_status_publishedAt_idx"
  ON "ProductPlanVersion"("status", "publishedAt");

CREATE UNIQUE INDEX "ProductPlanEntitlement_planVersionId_featureKey_key"
  ON "ProductPlanEntitlement"("planVersionId", "featureKey");

CREATE INDEX "ProductPlanEntitlement_featureKey_idx"
  ON "ProductPlanEntitlement"("featureKey");

ALTER TABLE "ProductPlanVersion"
  ADD CONSTRAINT "ProductPlanVersion_productPlanId_fkey"
  FOREIGN KEY ("productPlanId") REFERENCES "ProductPlan"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductPlanEntitlement"
  ADD CONSTRAINT "ProductPlanEntitlement_planVersionId_fkey"
  FOREIGN KEY ("planVersionId") REFERENCES "ProductPlanVersion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
