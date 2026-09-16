-- IRON-AI0 G2 — Persistence, Provenance & Configuration Profiles
-- Additive only. No raw prompt/request/response body or secret value is persisted.

CREATE TYPE "AiConfigurationScope" AS ENUM ('GLOBAL', 'TENANT');
CREATE TYPE "AiConfigurationStatus" AS ENUM ('ACTIVE', 'DISABLED', 'UNAVAILABLE');
CREATE TYPE "AiFallbackBehavior" AS ENUM ('FAIL_CLOSED', 'ADVISORY_FALLBACK');
CREATE TYPE "AiExecutionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'UNAVAILABLE', 'REJECTED');
CREATE TYPE "AiFailureCategory" AS ENUM ('TIMEOUT', 'OFFLINE', 'RATE_LIMIT', 'BAD_CREDENTIALS', 'UNAVAILABLE', 'INVALID_RESPONSE', 'POLICY_DENIED', 'ENTITLEMENT_DENIED', 'CONFIGURATION_UNAVAILABLE', 'PROVIDER_INTERNAL_ERROR');

CREATE TABLE "AiConfigurationProfile" (
  "id" TEXT NOT NULL,
  "scope" "AiConfigurationScope" NOT NULL,
  "gymId" TEXT,
  "capability" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "modelCode" TEXT NOT NULL,
  "endpoint" TEXT,
  "region" TEXT,
  "timeoutMs" INTEGER NOT NULL,
  "budgetUnits" INTEGER,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "fallbackBehavior" "AiFallbackBehavior" NOT NULL,
  "secretReference" TEXT,
  "status" "AiConfigurationStatus" NOT NULL,
  "version" INTEGER NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiConfigurationProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiConfigurationProfile_scope_shape" CHECK (
    ("scope" = 'GLOBAL' AND "gymId" IS NULL)
    OR ("scope" = 'TENANT' AND "gymId" IS NOT NULL)
  ),
  CONSTRAINT "AiConfigurationProfile_version_positive" CHECK ("version" > 0),
  CONSTRAINT "AiConfigurationProfile_timeout_safe" CHECK ("timeoutMs" >= 100),
  CONSTRAINT "AiConfigurationProfile_budget_nonnegative" CHECK ("budgetUnits" IS NULL OR "budgetUnits" >= 0),
  CONSTRAINT "AiConfigurationProfile_endpoint_https" CHECK ("endpoint" IS NULL OR "endpoint" ~ '^https://'),
  CONSTRAINT "AiConfigurationProfile_secret_reference_only" CHECK (
    "secretReference" IS NULL OR ("secretReference" !~ '[[:space:]=]' AND length("secretReference") BETWEEN 3 AND 256)
  )
);

CREATE TABLE "AiExecutionTrace" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "actorId" TEXT,
  "studentId" TEXT,
  "capability" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "modelCode" TEXT NOT NULL,
  "promptKey" TEXT NOT NULL,
  "promptVersion" INTEGER NOT NULL,
  "configurationProfileId" TEXT,
  "configurationVersion" INTEGER NOT NULL,
  "inputHash" TEXT NOT NULL,
  "outputHash" TEXT,
  "confidence" DOUBLE PRECISION,
  "flags" JSONB,
  "status" "AiExecutionStatus" NOT NULL,
  "failureCategory" "AiFailureCategory",
  "latencyMs" INTEGER NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiExecutionTrace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiExecutionTrace_prompt_version_positive" CHECK ("promptVersion" > 0),
  CONSTRAINT "AiExecutionTrace_configuration_version_positive" CHECK ("configurationVersion" > 0),
  CONSTRAINT "AiExecutionTrace_latency_nonnegative" CHECK ("latencyMs" >= 0),
  CONSTRAINT "AiExecutionTrace_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "AiExecutionTrace_input_hash_sha256" CHECK ("inputHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AiExecutionTrace_output_hash_sha256" CHECK ("outputHash" IS NULL OR "outputHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "AiConfigurationProfile_global_capability_version_key"
  ON "AiConfigurationProfile"("capability", "version") WHERE "scope" = 'GLOBAL';
CREATE UNIQUE INDEX "AiConfigurationProfile_tenant_capability_version_key"
  ON "AiConfigurationProfile"("gymId", "capability", "version") WHERE "scope" = 'TENANT';
CREATE INDEX "AiConfigurationProfile_scope_gymId_capability_status_version_idx"
  ON "AiConfigurationProfile"("scope", "gymId", "capability", "status", "version");
CREATE INDEX "AiConfigurationProfile_providerCode_modelCode_idx"
  ON "AiConfigurationProfile"("providerCode", "modelCode");
CREATE UNIQUE INDEX "AiExecutionTrace_requestId_key" ON "AiExecutionTrace"("requestId");
CREATE INDEX "AiExecutionTrace_gymId_capability_createdAt_idx" ON "AiExecutionTrace"("gymId", "capability", "createdAt");
CREATE INDEX "AiExecutionTrace_studentId_createdAt_idx" ON "AiExecutionTrace"("studentId", "createdAt");
CREATE INDEX "AiExecutionTrace_providerCode_modelCode_createdAt_idx" ON "AiExecutionTrace"("providerCode", "modelCode", "createdAt");
CREATE INDEX "AiExecutionTrace_configurationProfileId_idx" ON "AiExecutionTrace"("configurationProfileId");

ALTER TABLE "AiConfigurationProfile"
  ADD CONSTRAINT "AiConfigurationProfile_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiConfigurationProfile"
  ADD CONSTRAINT "AiConfigurationProfile_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiExecutionTrace"
  ADD CONSTRAINT "AiExecutionTrace_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiExecutionTrace"
  ADD CONSTRAINT "AiExecutionTrace_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiExecutionTrace"
  ADD CONSTRAINT "AiExecutionTrace_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiExecutionTrace"
  ADD CONSTRAINT "AiExecutionTrace_configurationProfileId_fkey" FOREIGN KEY ("configurationProfileId") REFERENCES "AiConfigurationProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
