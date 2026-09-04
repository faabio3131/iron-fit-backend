ALTER TABLE "AccessDevice"
ADD COLUMN "deviceTokenHash" TEXT,
ADD COLUMN "tokenRotatedAt" TIMESTAMP(3);

CREATE TABLE "AccessScanNonce" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessScanNonce_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccessScanNonce_deviceId_nonce_key"
ON "AccessScanNonce"("deviceId", "nonce");

CREATE INDEX "AccessScanNonce_expiresAt_idx"
ON "AccessScanNonce"("expiresAt");

ALTER TABLE "AccessScanNonce"
ADD CONSTRAINT "AccessScanNonce_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "AccessDevice"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
