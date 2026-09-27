-- IRON Commercial Readiness C14 — governed break-glass.
-- This table stores approval state only. It MUST NOT store a secret value or
-- secretReference. Exceptional access remains server-side and operation-bound.

CREATE TYPE "IntegrationBreakGlassStatus" AS ENUM (
  'REQUESTED',
  'APPROVED',
  'EXECUTING',
  'CONSUMED',
  'FAILED',
  'REVOKED',
  'EXPIRED'
);

CREATE TYPE "IntegrationBreakGlassOperation" AS ENUM (
  'PROVIDER_VERIFY'
);

CREATE TABLE "IntegrationBreakGlassGrant" (
  "id" TEXT NOT NULL,
  "integrationConnectionId" TEXT NOT NULL,
  "operation" "IntegrationBreakGlassOperation" NOT NULL,
  "reason" TEXT NOT NULL,
  "requestedTtlSeconds" INTEGER NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "status" "IntegrationBreakGlassStatus" NOT NULL DEFAULT 'REQUESTED',
  "approvedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "executionStartedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationBreakGlassGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationBreakGlassGrant_ttl" CHECK (
    "requestedTtlSeconds" BETWEEN 60 AND 900
  ),
  CONSTRAINT "IntegrationBreakGlassGrant_reason" CHECK (
    char_length("reason") BETWEEN 20 AND 500
  ),
  CONSTRAINT "IntegrationBreakGlassGrant_distinct_approver" CHECK (
    "approvedByUserId" IS NULL OR "approvedByUserId" <> "requestedByUserId"
  )
);

CREATE INDEX "IntegrationBreakGlassGrant_status_expiresAt_idx"
  ON "IntegrationBreakGlassGrant"("status", "expiresAt");
CREATE INDEX "IntegrationBreakGlassGrant_connection_status_idx"
  ON "IntegrationBreakGlassGrant"("integrationConnectionId", "status");
CREATE INDEX "IntegrationBreakGlassGrant_requester_createdAt_idx"
  ON "IntegrationBreakGlassGrant"("requestedByUserId", "createdAt");

ALTER TABLE "IntegrationBreakGlassGrant"
  ADD CONSTRAINT "IntegrationBreakGlassGrant_connection_fkey"
  FOREIGN KEY ("integrationConnectionId")
  REFERENCES "IntegrationConnection"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "IntegrationBreakGlassGrant"
  ADD CONSTRAINT "IntegrationBreakGlassGrant_requestedBy_fkey"
  FOREIGN KEY ("requestedByUserId")
  REFERENCES "User"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "IntegrationBreakGlassGrant"
  ADD CONSTRAINT "IntegrationBreakGlassGrant_approvedBy_fkey"
  FOREIGN KEY ("approvedByUserId")
  REFERENCES "User"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
