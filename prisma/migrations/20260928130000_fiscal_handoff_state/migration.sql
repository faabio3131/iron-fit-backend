-- IRON Macro J1 — durable fiscal handoff state.
-- This migration persists only provider-neutral fiscal orchestration metadata.
-- Fiscal provider credentials remain outside PostgreSQL in Integration Secret Vault.

CREATE TYPE "FiscalHandoffStatus" AS ENUM (
  'PENDING_CAPABILITY',
  'READY_TO_ISSUE',
  'SUBMITTED',
  'AUTHORIZED',
  'REJECTED',
  'RECONCILIATION_PENDING',
  'RECONCILED',
  'CANCELLATION_PENDING',
  'CANCELLED',
  'FAILED'
);

CREATE TABLE "FiscalHandoff" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "chargeId" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "contractVersion" TEXT NOT NULL,
  "hostNamespace" TEXT NOT NULL,
  "packId" TEXT NOT NULL,
  "useCaseId" TEXT NOT NULL,
  "operationKind" TEXT NOT NULL,
  "documentKind" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "paymentMethod" TEXT,
  "settledAt" TIMESTAMP(3),
  "status" "FiscalHandoffStatus" NOT NULL DEFAULT 'PENDING_CAPABILITY',
  "capabilityVersion" TEXT,
  "providerRequestId" TEXT,
  "providerDocumentId" TEXT,
  "providerAccessKey" TEXT,
  "providerProtocolReference" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "authorizedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FiscalHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalHandoff_chargeId_key"
  ON "FiscalHandoff"("chargeId");

CREATE UNIQUE INDEX "FiscalHandoff_transactionId_key"
  ON "FiscalHandoff"("transactionId");

CREATE UNIQUE INDEX "FiscalHandoff_idempotencyKey_key"
  ON "FiscalHandoff"("idempotencyKey");

CREATE INDEX "FiscalHandoff_gymId_status_idx"
  ON "FiscalHandoff"("gymId", "status");

CREATE INDEX "FiscalHandoff_status_nextAttemptAt_idx"
  ON "FiscalHandoff"("status", "nextAttemptAt");

CREATE INDEX "FiscalHandoff_providerDocumentId_idx"
  ON "FiscalHandoff"("providerDocumentId");

CREATE INDEX "FiscalHandoff_providerAccessKey_idx"
  ON "FiscalHandoff"("providerAccessKey");

ALTER TABLE "FiscalHandoff"
  ADD CONSTRAINT "FiscalHandoff_gymId_fkey"
  FOREIGN KEY ("gymId") REFERENCES "Gym"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FiscalHandoff"
  ADD CONSTRAINT "FiscalHandoff_chargeId_fkey"
  FOREIGN KEY ("chargeId") REFERENCES "Charge"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
