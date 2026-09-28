-- IRON Macro G — durable transactional auth e-mail delivery lifecycle.
-- Raw action tokens remain encrypted only until successful/terminal delivery.
-- Provider credentials remain exclusively in Integration Secret Vault.

ALTER TABLE "AuthActionToken"
  ALTER COLUMN "deliveryCiphertext" DROP NOT NULL,
  ADD COLUMN "deliveryAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "deliveryLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "deliveryLeaseOwner" TEXT,
  ADD COLUMN "deliveryLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "deliveryProviderCode" TEXT,
  ADD COLUMN "deliveryConnectionId" TEXT,
  ADD COLUMN "deliveryProviderMessageRef" TEXT,
  ADD COLUMN "deliveryErrorCode" TEXT;

CREATE INDEX "AuthActionToken_deliveryStatus_deliveryNextAttemptAt_idx"
  ON "AuthActionToken"("deliveryStatus", "deliveryNextAttemptAt");

CREATE INDEX "AuthActionToken_deliveryLeaseUntil_idx"
  ON "AuthActionToken"("deliveryLeaseUntil");
