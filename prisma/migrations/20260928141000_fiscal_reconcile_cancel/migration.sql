-- IRON Macro J4 — cancellation and reconciliation lifecycle metadata.

ALTER TABLE "FiscalHandoff"
  ADD COLUMN "cancellationRequestId" TEXT,
  ADD COLUMN "cancellationProtocolReference" TEXT,
  ADD COLUMN "cancellationRejectionCode" TEXT,
  ADD COLUMN "cancellationRejectionMessage" TEXT,
  ADD COLUMN "reconciliationFingerprint" TEXT,
  ADD COLUMN "reconciliationIssueCodes" JSONB;
