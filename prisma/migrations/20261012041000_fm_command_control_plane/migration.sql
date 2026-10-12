CREATE TABLE "FmCommandControlPlaneCommand" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "correlationId" TEXT NOT NULL,
  "result" JSONB,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "FmCommandControlPlaneCommand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FmCommandControlPlaneCommand_idempotencyKey_key"
ON "FmCommandControlPlaneCommand"("idempotencyKey");

CREATE INDEX "FmCommandControlPlaneCommand_gymId_createdAt_idx"
ON "FmCommandControlPlaneCommand"("gymId", "createdAt");

CREATE INDEX "FmCommandControlPlaneCommand_status_createdAt_idx"
ON "FmCommandControlPlaneCommand"("status", "createdAt");

ALTER TABLE "FmCommandControlPlaneCommand"
ADD CONSTRAINT "FmCommandControlPlaneCommand_gymId_fkey"
FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
