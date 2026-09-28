-- IRON Macro I6 — durable communication dispatch authority.
-- External messages keep an opaque internal idempotency/correlation key and canonical provider connection binding.
-- No provider credential is persisted in CommunicationMessage.

ALTER TABLE "CommunicationMessage"
  ADD COLUMN "dispatchKey" TEXT,
  ADD COLUMN "providerCode" TEXT,
  ADD COLUMN "providerConnectionId" TEXT,
  ADD COLUMN "providerMessageRef" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "dispatchLeaseOwner" TEXT,
  ADD COLUMN "dispatchLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "lastErrorCode" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "CommunicationMessage"
SET "dispatchKey" = "id"
WHERE "dispatchKey" IS NULL;

ALTER TABLE "CommunicationMessage"
  ALTER COLUMN "dispatchKey" SET NOT NULL;

CREATE UNIQUE INDEX "CommunicationMessage_dispatchKey_key"
  ON "CommunicationMessage"("dispatchKey");

CREATE INDEX "CommunicationMessage_gymId_channel_status_idx"
  ON "CommunicationMessage"("gymId", "channel", "status");

CREATE INDEX "CommunicationMessage_status_nextAttemptAt_idx"
  ON "CommunicationMessage"("status", "nextAttemptAt");

CREATE INDEX "CommunicationMessage_dispatchLeaseUntil_idx"
  ON "CommunicationMessage"("dispatchLeaseUntil");

CREATE INDEX "CommunicationMessage_providerConnectionId_status_idx"
  ON "CommunicationMessage"("providerConnectionId", "status");

ALTER TABLE "CommunicationMessage"
  ADD CONSTRAINT "CommunicationMessage_providerConnectionId_fkey"
  FOREIGN KEY ("providerConnectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
