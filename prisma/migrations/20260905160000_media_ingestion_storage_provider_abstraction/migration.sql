CREATE TYPE "CreatorMediaIngestionStatus" AS ENUM ('PREPARED', 'VERIFIED', 'FAILED');
CREATE TYPE "CreatorMediaIngestionFailure" AS ENUM (
  'PROVIDER_PREPARE_FAILED',
  'PROVIDER_INSPECTION_FAILED',
  'OBJECT_NOT_FOUND',
  'INTEGRITY_HASH_UNAVAILABLE',
  'INTEGRITY_MISMATCH',
  'INVALID_OBJECT_SIZE'
);

CREATE TABLE "CreatorMediaIngestion" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "CreatorMediaIngestionStatus" NOT NULL DEFAULT 'PREPARED',
    "failureCode" "CreatorMediaIngestionFailure",
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorMediaIngestion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreatorMediaIngestion_provider_code_check" CHECK (
      "providerCode" ~ '^[a-z][a-z0-9._-]{1,63}$'
    ),
    CONSTRAINT "CreatorMediaIngestion_object_key_check" CHECK (
      length("objectKey") BETWEEN 1 AND 1024
    ),
    CONSTRAINT "CreatorMediaIngestion_request_key_check" CHECK (
      length(trim("requestKey")) > 0
    ),
    CONSTRAINT "CreatorMediaIngestion_state_check" CHECK (
      ("status" = 'PREPARED' AND "failureCode" IS NULL AND "verifiedAt" IS NULL AND "failedAt" IS NULL)
      OR ("status" = 'VERIFIED' AND "failureCode" IS NULL AND "verifiedAt" IS NOT NULL AND "failedAt" IS NULL)
      OR ("status" = 'FAILED' AND "failureCode" IS NOT NULL AND "verifiedAt" IS NULL AND "failedAt" IS NOT NULL)
    )
);

CREATE TABLE "CreatorMediaStorageObject" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "sourceIngestionId" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "integritySha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "etag" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorMediaStorageObject_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreatorMediaStorageObject_provider_code_check" CHECK (
      "providerCode" ~ '^[a-z][a-z0-9._-]{1,63}$'
    ),
    CONSTRAINT "CreatorMediaStorageObject_object_key_check" CHECK (
      length("objectKey") BETWEEN 1 AND 1024
    ),
    CONSTRAINT "CreatorMediaStorageObject_integrity_hash_check" CHECK (
      "integritySha256" ~ '^[0-9A-Fa-f]{64}$'
    ),
    CONSTRAINT "CreatorMediaStorageObject_size_check" CHECK (
      "sizeBytes" > 0
    )
);

CREATE UNIQUE INDEX "CreatorMediaIngestion_fingerprint_key"
ON "CreatorMediaIngestion"("fingerprint");
CREATE UNIQUE INDEX "CreatorMediaIngestion_mediaAssetId_requestKey_key"
ON "CreatorMediaIngestion"("mediaAssetId", "requestKey");
CREATE INDEX "CreatorMediaIngestion_mediaAssetId_status_idx"
ON "CreatorMediaIngestion"("mediaAssetId", "status");
CREATE INDEX "CreatorMediaIngestion_providerCode_status_idx"
ON "CreatorMediaIngestion"("providerCode", "status");

CREATE UNIQUE INDEX "CreatorMediaStorageObject_mediaAssetId_providerCode_key"
ON "CreatorMediaStorageObject"("mediaAssetId", "providerCode");
CREATE UNIQUE INDEX "CreatorMediaStorageObject_providerCode_objectKey_key"
ON "CreatorMediaStorageObject"("providerCode", "objectKey");
CREATE INDEX "CreatorMediaStorageObject_mediaAssetId_verifiedAt_idx"
ON "CreatorMediaStorageObject"("mediaAssetId", "verifiedAt");
CREATE INDEX "CreatorMediaStorageObject_providerCode_verifiedAt_idx"
ON "CreatorMediaStorageObject"("providerCode", "verifiedAt");

ALTER TABLE "CreatorMediaIngestion"
ADD CONSTRAINT "CreatorMediaIngestion_mediaAssetId_fkey"
FOREIGN KEY ("mediaAssetId") REFERENCES "CreatorMediaAsset"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorMediaStorageObject"
ADD CONSTRAINT "CreatorMediaStorageObject_mediaAssetId_fkey"
FOREIGN KEY ("mediaAssetId") REFERENCES "CreatorMediaAsset"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorMediaStorageObject"
ADD CONSTRAINT "CreatorMediaStorageObject_sourceIngestionId_fkey"
FOREIGN KEY ("sourceIngestionId") REFERENCES "CreatorMediaIngestion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
