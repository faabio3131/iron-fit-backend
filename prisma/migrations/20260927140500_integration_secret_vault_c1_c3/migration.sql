-- IRON Commercial Readiness — Macrobloco C1-C3
-- No cleartext credential or real Vault payload is stored here.

CREATE TYPE "IntegrationScope" AS ENUM ('GLOBAL', 'TENANT');
CREATE TYPE "IntegrationEnvironment" AS ENUM ('DEV', 'HOMOLOG', 'PROD');
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'DEGRADED', 'SUSPENDED', 'DISCONNECTED');

CREATE TABLE "IntegrationConnection" (
  "id" TEXT NOT NULL,
  "scope" "IntegrationScope" NOT NULL,
  "gymId" TEXT,
  "providerCode" TEXT NOT NULL,
  "environment" "IntegrationEnvironment" NOT NULL,
  "authModel" TEXT NOT NULL,
  "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "capabilities" JSONB NOT NULL,
  "publicConfiguration" JSONB,
  "secretReference" TEXT,
  "createdByUserId" TEXT,
  "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationConnection_scope_shape" CHECK (
    ("scope" = 'GLOBAL' AND "gymId" IS NULL)
    OR ("scope" = 'TENANT' AND "gymId" IS NOT NULL)
  ),
  CONSTRAINT "IntegrationConnection_provider_code" CHECK (
    "providerCode" ~ '^[a-z][a-z0-9._-]{1,63}$'
  ),
  CONSTRAINT "IntegrationConnection_auth_model" CHECK (
    "authModel" ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  CONSTRAINT "IntegrationConnection_secret_reference_only" CHECK (
    "secretReference" IS NULL OR "secretReference" ~ '^isv_[A-Za-z0-9_-]{43}$'
  )
);

CREATE UNIQUE INDEX "IntegrationConnection_global_provider_env_key"
  ON "IntegrationConnection"("providerCode", "environment")
  WHERE "scope" = 'GLOBAL' AND "gymId" IS NULL;

CREATE UNIQUE INDEX "IntegrationConnection_tenant_provider_env_key"
  ON "IntegrationConnection"("gymId", "providerCode", "environment")
  WHERE "scope" = 'TENANT' AND "gymId" IS NOT NULL;

CREATE INDEX "IntegrationConnection_scope_gym_provider_env_idx"
  ON "IntegrationConnection"("scope", "gymId", "providerCode", "environment");
CREATE INDEX "IntegrationConnection_provider_env_status_idx"
  ON "IntegrationConnection"("providerCode", "environment", "status");
CREATE INDEX "IntegrationConnection_gym_status_idx"
  ON "IntegrationConnection"("gymId", "status");

ALTER TABLE "IntegrationConnection"
  ADD CONSTRAINT "IntegrationConnection_gymId_fkey"
  FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IntegrationConnection"
  ADD CONSTRAINT "IntegrationConnection_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
