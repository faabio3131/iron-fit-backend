-- IRON M5 — canonical operational state for onboarding.
-- AuditLog remains evidence only; workflow ordering comes from this table.

CREATE TABLE "CommercialOnboardingCheckpoint" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "completedByUserId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialOnboardingCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommercialOnboardingCheckpoint_gymId_step_key"
ON "CommercialOnboardingCheckpoint"("gymId", "step");

CREATE INDEX "CommercialOnboardingCheckpoint_gymId_completedAt_idx"
ON "CommercialOnboardingCheckpoint"("gymId", "completedAt");

CREATE INDEX "CommercialOnboardingCheckpoint_completedByUserId_completedAt_idx"
ON "CommercialOnboardingCheckpoint"("completedByUserId", "completedAt");

ALTER TABLE "CommercialOnboardingCheckpoint"
ADD CONSTRAINT "CommercialOnboardingCheckpoint_gymId_fkey"
FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommercialOnboardingCheckpoint"
ADD CONSTRAINT "CommercialOnboardingCheckpoint_completedByUserId_fkey"
FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
