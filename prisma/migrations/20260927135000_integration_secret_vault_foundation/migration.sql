-- IRON Commercial Readiness C1-C5 — Integration & Secret Vault foundation.
-- The operational database stores metadata and opaque references only.
-- Reusable provider credentials live exclusively in the external vault.

CREATE TYPE "IntegrationScope" AS ENUM ('GLOBAL', 'TENANT');
CREATE TYPE "IntegrationEnvironment" AS ENUM ('DEV', 'HOMOLOG', 'PROD');
CREATE TYPE "IntegrationConnectionStatus" AS ENUM (
  'PENDING',
  'CONFIGURED',
  'ACTIVE',
  'DEGRADED',
  'REVOKED'
);
CREATE TYPE "IntegrationSecretStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

CREATE TABLE "IntegrationConnection" (
  "id" TEXT NOT NULL,
  "scope" "IntegrationScope" NOT NULL,
  "gymId" TEXT,
  "providerCode" TEXT NOT NULL,
  "environment" "IntegrationEnvironment" NOT NULL,
  "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "capabilities" JSONB NOT NULL,
  "publicConfiguration" JSONB,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationConnection_scope_gym_check" CHECK (
    ("scope" = 'GLOBAL' AND "gymId" IS NULL)
    OR
    ("scope" = 'TENANT' AND "gymId" IS NOT NULL)
  ),
  CONSTRAINT "IntegrationConnection_provider_code_check" CHECK (
    "providerCode" ~ '^[a-z][a-z0-9._-]{1,63}$'
  )
);

CREATE TABLE "IntegrationSecretVersion" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "IntegrationSecretStatus" NOT NULL DEFAULT 'ACTIVE',
  "vaultVersion" INTEGER,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rotatedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "IntegrationSecretVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationSecretVersion_version_positive" CHECK ("version" > 0),
  CONSTRAINT "IntegrationSecretVersion_vault_version_positive" CHECK (
    "vaultVersion" IS NULL OR "vaultVersion" > 0
  )
);

CREATE UNIQUE INDEX "IntegrationConnection_global_provider_environment_key"
  ON "IntegrationConnection"("providerCode", "environment")
  WHERE "scope" = 'GLOBAL' AND "gymId" IS NULL;

CREATE UNIQUE INDEX "IntegrationConnection_tenant_provider_environment_key"
  ON "IntegrationConnection"("gymId", "providerCode", "environment")
  WHERE "scope" = 'TENANT' AND "gymId" IS NOT NULL;

CREATE INDEX "IntegrationConnection_scope_gymId_status_idx"
  ON "IntegrationConnection"("scope", "gymId", "status");
CREATE INDEX "IntegrationConnection_providerCode_environment_status_idx"
  ON "IntegrationConnection"("providerCode", "environment", "status");

CREATE UNIQUE INDEX "IntegrationSecretVersion_referenceId_key"
  ON "IntegrationSecretVersion"("referenceId");
CREATE UNIQUE INDEX "IntegrationSecretVersion_connectionId_version_key"
  ON "IntegrationSecretVersion"("connectionId", "version");
CREATE INDEX "IntegrationSecretVersion_connectionId_status_version_idx"
  ON "IntegrationSecretVersion"("connectionId", "status", "version");
CREATE INDEX "IntegrationSecretVersion_expiresAt_status_idx"
  ON "IntegrationSecretVersion"("expiresAt", "status");

ALTER TABLE "IntegrationConnection"
  ADD CONSTRAINT "IntegrationConnection_gymId_fkey"
  FOREIGN KEY ("gymId") REFERENCES "Gym"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationSecretVersion"
  ADD CONSTRAINT "IntegrationSecretVersion_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
