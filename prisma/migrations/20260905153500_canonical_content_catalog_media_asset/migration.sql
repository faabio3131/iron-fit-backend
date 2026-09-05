CREATE TYPE "CreatorMediaAssetKind" AS ENUM ('VIDEO', 'AUDIO', 'IMAGE');

CREATE TABLE "CreatorContent" (
    "id" TEXT NOT NULL,
    "scope" "CreatorRightsScope" NOT NULL,
    "gymId" TEXT,
    "canonicalKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "relationKind" "CreatorManagedRelationKind" NOT NULL,
    "creatorId" TEXT,
    "rightsGrantId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorContent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreatorContent_scope_gym_check" CHECK (
      ("scope" = 'GLOBAL' AND "gymId" IS NULL)
      OR ("scope" = 'TENANT' AND "gymId" IS NOT NULL)
    ),
    CONSTRAINT "CreatorContent_relation_scope_check" CHECK (
      ("scope" = 'TENANT' AND "relationKind" = 'TENANT_OWNED')
      OR ("scope" = 'GLOBAL' AND "relationKind" <> 'TENANT_OWNED')
    ),
    CONSTRAINT "CreatorContent_canonical_key_check" CHECK (
      "canonicalKey" ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
    ),
    CONSTRAINT "CreatorContent_title_check" CHECK (length(trim("title")) > 0)
);

CREATE TABLE "CreatorMediaAsset" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "kind" "CreatorMediaAssetKind" NOT NULL,
    "integritySha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "languageCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorMediaAsset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreatorMediaAsset_integrity_hash_check" CHECK (
      "integritySha256" ~ '^[0-9A-Fa-f]{64}$'
    ),
    CONSTRAINT "CreatorMediaAsset_mime_type_check" CHECK (length(trim("mimeType")) > 0),
    CONSTRAINT "CreatorMediaAsset_duration_check" CHECK (
      "durationMs" IS NULL OR ("durationMs" > 0 AND "durationMs" <= 86400000)
    ),
    CONSTRAINT "CreatorMediaAsset_width_check" CHECK (
      "width" IS NULL OR ("width" > 0 AND "width" <= 32768)
    ),
    CONSTRAINT "CreatorMediaAsset_height_check" CHECK (
      "height" IS NULL OR ("height" > 0 AND "height" <= 32768)
    )
);

CREATE UNIQUE INDEX "CreatorContent_fingerprint_key" ON "CreatorContent"("fingerprint");
CREATE UNIQUE INDEX "CreatorContent_global_canonical_key_key"
ON "CreatorContent"("canonicalKey") WHERE "scope" = 'GLOBAL';
CREATE UNIQUE INDEX "CreatorContent_tenant_canonical_key_key"
ON "CreatorContent"("gymId", "canonicalKey") WHERE "scope" = 'TENANT';
CREATE INDEX "CreatorContent_scope_gymId_createdAt_idx" ON "CreatorContent"("scope", "gymId", "createdAt");
CREATE INDEX "CreatorContent_creatorId_createdAt_idx" ON "CreatorContent"("creatorId", "createdAt");
CREATE INDEX "CreatorContent_rightsGrantId_idx" ON "CreatorContent"("rightsGrantId");

CREATE UNIQUE INDEX "CreatorMediaAsset_contentId_integritySha256_key"
ON "CreatorMediaAsset"("contentId", "integritySha256");
CREATE INDEX "CreatorMediaAsset_contentId_kind_idx" ON "CreatorMediaAsset"("contentId", "kind");
CREATE INDEX "CreatorMediaAsset_integritySha256_idx" ON "CreatorMediaAsset"("integritySha256");

ALTER TABLE "CreatorContent"
ADD CONSTRAINT "CreatorContent_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "Creator"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorContent"
ADD CONSTRAINT "CreatorContent_rightsGrantId_fkey"
FOREIGN KEY ("rightsGrantId") REFERENCES "CreatorRightsGrant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorMediaAsset"
ADD CONSTRAINT "CreatorMediaAsset_contentId_fkey"
FOREIGN KEY ("contentId") REFERENCES "CreatorContent"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
