CREATE TYPE "CreatorExerciseContentPlacement" AS ENUM ('PRIMARY', 'ALTERNATIVE');
CREATE TYPE "CreatorExerciseContentPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

CREATE TABLE "CreatorExerciseContentMapping" (
    "id" TEXT NOT NULL,
    "scope" "CreatorRightsScope" NOT NULL,
    "gymId" TEXT,
    "exerciseId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "placement" "CreatorExerciseContentPlacement" NOT NULL DEFAULT 'PRIMARY',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" "CreatorExerciseContentPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "fingerprint" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "unpublishedAt" TIMESTAMP(3),
    "unpublishReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorExerciseContentMapping_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CN5_scope_gym_check" CHECK (
      ("scope" = 'GLOBAL' AND "gymId" IS NULL) OR
      ("scope" = 'TENANT' AND "gymId" IS NOT NULL)
    ),
    CONSTRAINT "CN5_priority_check" CHECK ("priority" BETWEEN 1 AND 1000),
    CONSTRAINT "CN5_unpublish_reason_check" CHECK (
      "unpublishReason" IS NULL OR length(btrim("unpublishReason")) BETWEEN 3 AND 500
    ),
    CONSTRAINT "CN5_publication_state_check" CHECK (
      ("status" = 'DRAFT' AND "publishedAt" IS NULL AND "unpublishedAt" IS NULL AND "unpublishReason" IS NULL) OR
      ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL AND "unpublishedAt" IS NULL AND "unpublishReason" IS NULL) OR
      ("status" = 'UNPUBLISHED' AND "publishedAt" IS NOT NULL AND "unpublishedAt" IS NOT NULL AND "unpublishReason" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "CreatorExerciseContentMapping_fingerprint_key"
  ON "CreatorExerciseContentMapping"("fingerprint");
CREATE INDEX "CN5_scope_exercise_status_idx"
  ON "CreatorExerciseContentMapping"("scope", "gymId", "exerciseId", "status");
CREATE INDEX "CN5_content_status_idx"
  ON "CreatorExerciseContentMapping"("contentId", "status");
CREATE INDEX "CN5_asset_status_idx"
  ON "CreatorExerciseContentMapping"("mediaAssetId", "status");

CREATE UNIQUE INDEX "CN5_global_identity_uq"
  ON "CreatorExerciseContentMapping"("exerciseId", "contentId", "mediaAssetId", "placement")
  WHERE "scope" = 'GLOBAL' AND "gymId" IS NULL;
CREATE UNIQUE INDEX "CN5_tenant_identity_uq"
  ON "CreatorExerciseContentMapping"("gymId", "exerciseId", "contentId", "mediaAssetId", "placement")
  WHERE "scope" = 'TENANT' AND "gymId" IS NOT NULL;

CREATE UNIQUE INDEX "CN5_global_primary_pub_uq"
  ON "CreatorExerciseContentMapping"("exerciseId")
  WHERE "scope" = 'GLOBAL' AND "gymId" IS NULL AND "placement" = 'PRIMARY' AND "status" = 'PUBLISHED';
CREATE UNIQUE INDEX "CN5_tenant_primary_pub_uq"
  ON "CreatorExerciseContentMapping"("gymId", "exerciseId")
  WHERE "scope" = 'TENANT' AND "gymId" IS NOT NULL AND "placement" = 'PRIMARY' AND "status" = 'PUBLISHED';

ALTER TABLE "CreatorExerciseContentMapping"
  ADD CONSTRAINT "CN5_exercise_fk"
  FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorExerciseContentMapping"
  ADD CONSTRAINT "CN5_content_fk"
  FOREIGN KEY ("contentId") REFERENCES "CreatorContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorExerciseContentMapping"
  ADD CONSTRAINT "CN5_media_asset_fk"
  FOREIGN KEY ("mediaAssetId") REFERENCES "CreatorMediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
