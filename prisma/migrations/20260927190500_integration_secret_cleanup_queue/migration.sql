-- IRON Commercial Readiness C6-C8 hardening.
-- Durable recovery authority for opaque Vault references after partial external failures.
-- No reusable secret value is stored here.

CREATE TYPE "IntegrationSecretCleanupStatus" AS ENUM ('PENDING', 'COMPLETED');

CREATE TABLE "IntegrationSecretCleanupTask" (
  "id" TEXT NOT NULL,
  "integrationConnectionId" TEXT,
  "secretReference" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "IntegrationSecretCleanupStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationSecretCleanupTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationSecretCleanupTask_secret_reference" CHECK (
    "secretReference" ~ '^isv_[A-Za-z0-9_-]{43}$'
  ),
  CONSTRAINT "IntegrationSecretCleanupTask_reason" CHECK (
    "reason" ~ '^[A-Z][A-Z0-9_]{2,95}$'
  ),
  CONSTRAINT "IntegrationSecretCleanupTask_attempts" CHECK ("attempts" > 0)
);

CREATE UNIQUE INDEX "IntegrationSecretCleanupTask_secretReference_key"
  ON "IntegrationSecretCleanupTask"("secretReference");
CREATE INDEX "IntegrationSecretCleanupTask_status_lastAttemptAt_idx"
  ON "IntegrationSecretCleanupTask"("status", "lastAttemptAt");
CREATE INDEX "IntegrationSecretCleanupTask_connection_status_idx"
  ON "IntegrationSecretCleanupTask"("integrationConnectionId", "status");

ALTER TABLE "IntegrationSecretCleanupTask"
  ADD CONSTRAINT "IntegrationSecretCleanupTask_integrationConnectionId_fkey"
  FOREIGN KEY ("integrationConnectionId")
  REFERENCES "IntegrationConnection"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
