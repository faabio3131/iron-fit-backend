-- IRON M5 — durable idempotency authority for zero-touch commercial trial provisioning.
-- The request id is the physical concurrency barrier. A failed provisioning transaction
-- rolls this row back together with User/Gym/Role/Subscription/AuditLog creation.

CREATE TABLE "CommercialTrialProvisioning" (
    "requestId" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "trialStartedAt" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialTrialProvisioning_pkey" PRIMARY KEY ("requestId")
);

CREATE INDEX "CommercialTrialProvisioning_gymId_createdAt_idx"
ON "CommercialTrialProvisioning"("gymId", "createdAt");

CREATE INDEX "CommercialTrialProvisioning_userId_createdAt_idx"
ON "CommercialTrialProvisioning"("userId", "createdAt");
