-- IRON-PE3 — Tenant Configuration + Student Experience Policies
-- Additive configuration layers. No plan transition, pricing, or student-finance changes.

CREATE TABLE "TenantProductConfiguration" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "kind" "ProductEntitlementKind" NOT NULL,
  "featureEnabled" BOOLEAN,
  "limitValue" INTEGER,
  "policyValues" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantProductConfiguration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantProductConfiguration_value_shape" CHECK (
    ("kind" = 'FEATURE' AND "featureEnabled" IS NOT NULL AND "limitValue" IS NULL AND "policyValues" IS NULL)
    OR
    ("kind" = 'LIMIT' AND "featureEnabled" IS NULL AND "limitValue" IS NOT NULL AND "limitValue" >= 0 AND "policyValues" IS NULL)
    OR
    ("kind" = 'POLICY' AND "featureEnabled" IS NULL AND "limitValue" IS NULL AND "policyValues" IS NOT NULL AND jsonb_typeof("policyValues") = 'array')
  )
);

CREATE UNIQUE INDEX "TenantProductConfiguration_gymId_featureKey_key"
  ON "TenantProductConfiguration"("gymId", "featureKey");
CREATE INDEX "TenantProductConfiguration_gymId_idx"
  ON "TenantProductConfiguration"("gymId");

ALTER TABLE "TenantProductConfiguration"
  ADD CONSTRAINT "TenantProductConfiguration_gymId_fkey"
  FOREIGN KEY ("gymId") REFERENCES "Gym"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudentProductPreference" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "kind" "ProductEntitlementKind" NOT NULL,
  "featureEnabled" BOOLEAN,
  "limitValue" INTEGER,
  "policyValues" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentProductPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentProductPreference_value_shape" CHECK (
    ("kind" = 'FEATURE' AND "featureEnabled" IS NOT NULL AND "limitValue" IS NULL AND "policyValues" IS NULL)
    OR
    ("kind" = 'LIMIT' AND "featureEnabled" IS NULL AND "limitValue" IS NOT NULL AND "limitValue" >= 0 AND "policyValues" IS NULL)
    OR
    ("kind" = 'POLICY' AND "featureEnabled" IS NULL AND "limitValue" IS NULL AND "policyValues" IS NOT NULL AND jsonb_typeof("policyValues") = 'array')
  )
);

CREATE UNIQUE INDEX "StudentProductPreference_studentId_featureKey_key"
  ON "StudentProductPreference"("studentId", "featureKey");
CREATE INDEX "StudentProductPreference_studentId_idx"
  ON "StudentProductPreference"("studentId");

ALTER TABLE "StudentProductPreference"
  ADD CONSTRAINT "StudentProductPreference_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
