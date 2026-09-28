-- IRON Macro I7 — independent OAuth least-privilege scope policy authority.
-- Scope policy is non-secret governance metadata; OAuth apps cannot self-approve broader scopes.

CREATE TYPE "IntegrationOAuthScopePolicyStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

CREATE TABLE "IntegrationOAuthScopePolicy" (
  "id" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "environment" "IntegrationEnvironment" NOT NULL,
  "capability" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "IntegrationOAuthScopePolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "scopes" JSONB NOT NULL,
  "rationale" TEXT,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationOAuthScopePolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationOAuthScopePolicy_version_positive" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "IntegrationOAuthScopePolicy_provider_environment_capability_version_key"
  ON "IntegrationOAuthScopePolicy"("providerCode", "environment", "capability", "version");

CREATE UNIQUE INDEX "IntegrationOAuthScopePolicy_one_approved_per_capability"
  ON "IntegrationOAuthScopePolicy"("providerCode", "environment", "capability")
  WHERE "status" = 'APPROVED';

CREATE INDEX "IntegrationOAuthScopePolicy_provider_environment_status_idx"
  ON "IntegrationOAuthScopePolicy"("providerCode", "environment", "status");

CREATE INDEX "IntegrationOAuthScopePolicy_capability_status_idx"
  ON "IntegrationOAuthScopePolicy"("capability", "status");
