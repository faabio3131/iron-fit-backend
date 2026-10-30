CREATE TABLE "TenantPaymentReconciliationPolicy" (
  "gymId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" TEXT,
  CONSTRAINT "TenantPaymentReconciliationPolicy_pkey" PRIMARY KEY ("gymId")
);
ALTER TABLE "TenantPaymentWebhookInbox"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "TenantPaymentWebhookInbox_status_nextAttemptAt_idx"
  ON "TenantPaymentWebhookInbox"("status", "nextAttemptAt");
