ALTER TABLE "AccessDevice" ADD COLUMN IF NOT EXISTS "manufacturer" TEXT;
ALTER TABLE "AccessDevice" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "AccessDevice" ADD COLUMN IF NOT EXISTS "certificationStatus" TEXT NOT NULL DEFAULT 'NOT_HOMOLOGATED';
ALTER TABLE "AccessDevice" ADD COLUMN IF NOT EXISTS "certificationRef" TEXT;

-- Additive passage lifecycle. Existing AccessEvent remains the canonical
-- decision audit; this table distinguishes actual passage from decisions.
CREATE TABLE IF NOT EXISTS "PhysicalAccessAttempt" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "studentId" TEXT,
  "authorizationId" TEXT NOT NULL,
  "decisionEventId" TEXT,
  "state" TEXT NOT NULL DEFAULT 'REQUESTED',
  "manufacturer" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "vendorEventId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PhysicalAccessAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalAccessAttempt_authorizationId_key" ON "PhysicalAccessAttempt"("authorizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalAccessAttempt_deviceId_vendorEventId_key" ON "PhysicalAccessAttempt"("deviceId", "vendorEventId");
CREATE INDEX IF NOT EXISTS "PhysicalAccessAttempt_gymId_createdAt_idx" ON "PhysicalAccessAttempt"("gymId", "createdAt");
CREATE INDEX IF NOT EXISTS "PhysicalAccessAttempt_deviceId_state_idx" ON "PhysicalAccessAttempt"("deviceId", "state");
