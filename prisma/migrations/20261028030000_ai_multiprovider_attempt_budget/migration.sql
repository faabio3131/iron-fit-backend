ALTER TABLE "AiConfigurationProfile"
  ADD COLUMN "consumedUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxOutputTokens" INTEGER NOT NULL DEFAULT 1024,
  ADD COLUMN "fallbackTargets" JSONB,
  ADD COLUMN "pricing" JSONB;
ALTER TABLE "AiConfigurationProfile"
  ADD CONSTRAINT "AiConfigurationProfile_consumed_nonnegative" CHECK ("consumedUnits" >= 0),
  ADD CONSTRAINT "AiConfigurationProfile_output_tokens_safe" CHECK ("maxOutputTokens" BETWEEN 1 AND 8192),
  ADD CONSTRAINT "AiConfigurationProfile_fallback_array" CHECK ("fallbackTargets" IS NULL OR (jsonb_typeof("fallbackTargets") = 'array' AND jsonb_array_length("fallbackTargets") <= 2));
CREATE TABLE "AiProviderAttempt" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "inputHash" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "modelCode" TEXT NOT NULL,
  "promptKey" TEXT NOT NULL,
  "promptVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "failureCategory" TEXT,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "latencyMs" INTEGER,
  "estimatedCostNanoUsd" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AiProviderAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiProviderAttempt_ordinal_safe" CHECK ("ordinal" BETWEEN 0 AND 5),
  CONSTRAINT "AiProviderAttempt_usage_safe" CHECK (("inputTokens" IS NULL OR "inputTokens" >= 0) AND ("outputTokens" IS NULL OR "outputTokens" >= 0)),
  CONSTRAINT "AiProviderAttempt_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "AiConfigurationProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AiProviderAttempt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiProviderAttempt_tenantId_requestId_ordinal_key" ON "AiProviderAttempt"("tenantId", "requestId", "ordinal");
CREATE INDEX "AiProviderAttempt_profileId_createdAt_idx" ON "AiProviderAttempt"("profileId", "createdAt");
