-- IRON-PE2 — Tenant Subscription + Feature Resolution Engine
-- Additive tenant SaaS subscription domain. Does not alter the student's financial Subscription.

CREATE TYPE "TenantProductSubscriptionStatus" AS ENUM (
  'ACTIVE',
  'SUSPENDED',
  'CANCELED'
);

CREATE TABLE "TenantProductSubscription" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "status" "TenantProductSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantProductSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantProductSubscription_effective_window" CHECK (
    "effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom"
  )
);

CREATE INDEX "TenantProductSubscription_gymId_status_idx"
  ON "TenantProductSubscription"("gymId", "status");

CREATE INDEX "TenantProductSubscription_planVersionId_status_idx"
  ON "TenantProductSubscription"("planVersionId", "status");

CREATE UNIQUE INDEX "TenantProductSubscription_one_active_per_gym"
  ON "TenantProductSubscription"("gymId")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "TenantProductSubscription"
  ADD CONSTRAINT "TenantProductSubscription_gymId_fkey"
  FOREIGN KEY ("gymId") REFERENCES "Gym"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TenantProductSubscription"
  ADD CONSTRAINT "TenantProductSubscription_planVersionId_fkey"
  FOREIGN KEY ("planVersionId") REFERENCES "ProductPlanVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
