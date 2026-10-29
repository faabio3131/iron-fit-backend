-- Tenant-owned, deduplicated inbox of signed payment notifications.
-- Financial settlement always requires authoritative provider re-verification.
CREATE TABLE "TenantPaymentWebhookInbox" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "providerObjectRef" TEXT,
  "chargeId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantPaymentWebhookInbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantPaymentWebhookInbox_connectionId_providerEventId_key"
  ON "TenantPaymentWebhookInbox"("connectionId", "providerEventId");
CREATE INDEX "TenantPaymentWebhookInbox_gymId_receivedAt_idx"
  ON "TenantPaymentWebhookInbox"("gymId", "receivedAt");
CREATE INDEX "TenantPaymentWebhookInbox_gymId_status_idx"
  ON "TenantPaymentWebhookInbox"("gymId", "status");
