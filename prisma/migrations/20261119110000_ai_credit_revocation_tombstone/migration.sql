-- Preserve refund authority across asynchronous/out-of-order FM Command events.
CREATE TABLE "AiCreditRevocation" (
    "sourceInvoiceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCreditRevocation_pkey" PRIMARY KEY ("sourceInvoiceId")
);
CREATE INDEX "AiCreditRevocation_tenantId_createdAt_idx" ON "AiCreditRevocation"("tenantId","createdAt");
-- Existing revoked grants already deny replay; backfill durable tombstones.
INSERT INTO "AiCreditRevocation" ("sourceInvoiceId","tenantId","createdAt")
SELECT "sourceInvoiceId","tenantId","revokedAt" FROM "AiCreditGrant" WHERE "revokedAt" IS NOT NULL
ON CONFLICT ("sourceInvoiceId") DO NOTHING;
