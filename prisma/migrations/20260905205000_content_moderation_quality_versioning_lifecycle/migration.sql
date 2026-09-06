CREATE TYPE "CreatorContentLifecycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'RETIRED');
CREATE TYPE "CreatorContentVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED', 'SUPERSEDED');
CREATE TYPE "CreatorContentModerationDecision" AS ENUM ('APPROVE', 'REJECT');
CREATE TYPE "CreatorContentQualityVerdict" AS ENUM ('PASS', 'FAIL', 'NOT_APPLICABLE');

ALTER TABLE "CreatorContent"
  ADD COLUMN "lifecycleStatus" "CreatorContentLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "activatedAt" TIMESTAMP(3),
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "retiredAt" TIMESTAMP(3),
  ADD COLUMN "lifecycleReason" TEXT;

ALTER TABLE "CreatorContent"
  ADD CONSTRAINT "CN6_content_lifecycle_reason_check" CHECK (
    "lifecycleReason" IS NULL OR length(btrim("lifecycleReason")) BETWEEN 3 AND 500
  ),
  ADD CONSTRAINT "CN6_content_lifecycle_state_check" CHECK (
    ("lifecycleStatus" = 'DRAFT' AND "activatedAt" IS NULL AND "suspendedAt" IS NULL AND "retiredAt" IS NULL AND "lifecycleReason" IS NULL) OR
    ("lifecycleStatus" = 'ACTIVE' AND "activatedAt" IS NOT NULL AND "suspendedAt" IS NULL AND "retiredAt" IS NULL AND "lifecycleReason" IS NULL) OR
    ("lifecycleStatus" = 'SUSPENDED' AND "activatedAt" IS NOT NULL AND "suspendedAt" IS NOT NULL AND "retiredAt" IS NULL AND "lifecycleReason" IS NOT NULL) OR
    ("lifecycleStatus" = 'RETIRED' AND "retiredAt" IS NOT NULL AND "lifecycleReason" IS NOT NULL)
  );

CREATE INDEX "CN6_content_lifecycle_idx"
  ON "CreatorContent"("scope", "gymId", "lifecycleStatus");

CREATE TABLE "CreatorContentVersion" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "editorialTitle" TEXT NOT NULL,
    "editorialDescription" TEXT,
    "status" "CreatorContentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "fingerprint" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorContentVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CN6_version_positive_check" CHECK ("version" > 0),
    CONSTRAINT "CN6_editorial_title_check" CHECK (length(btrim("editorialTitle")) BETWEEN 1 AND 200),
    CONSTRAINT "CN6_editorial_description_check" CHECK (
      "editorialDescription" IS NULL OR length("editorialDescription") <= 2000
    ),
    CONSTRAINT "CN6_version_review_state_check" CHECK (
      ("status" = 'DRAFT' AND "reviewedAt" IS NULL) OR
      ("status" IN ('APPROVED', 'REJECTED', 'SUPERSEDED') AND "reviewedAt" IS NOT NULL)
    )
);

CREATE TABLE "CreatorContentReview" (
    "id" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "decision" "CreatorContentModerationDecision" NOT NULL,
    "technicalQuality" "CreatorContentQualityVerdict" NOT NULL,
    "instructionalQuality" "CreatorContentQualityVerdict" NOT NULL,
    "safetyQuality" "CreatorContentQualityVerdict" NOT NULL,
    "accessibilityQuality" "CreatorContentQualityVerdict" NOT NULL,
    "notes" TEXT,
    "reviewerUserId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorContentReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CN6_review_required_quality_check" CHECK (
      "technicalQuality" <> 'NOT_APPLICABLE' AND
      "instructionalQuality" <> 'NOT_APPLICABLE' AND
      "safetyQuality" <> 'NOT_APPLICABLE'
    ),
    CONSTRAINT "CN6_review_decision_quality_check" CHECK (
      (
        "decision" = 'APPROVE' AND
        "technicalQuality" = 'PASS' AND
        "instructionalQuality" = 'PASS' AND
        "safetyQuality" = 'PASS' AND
        "accessibilityQuality" IN ('PASS', 'NOT_APPLICABLE')
      ) OR (
        "decision" = 'REJECT' AND (
          "technicalQuality" = 'FAIL' OR
          "instructionalQuality" = 'FAIL' OR
          "safetyQuality" = 'FAIL' OR
          "accessibilityQuality" = 'FAIL'
        )
      )
    ),
    CONSTRAINT "CN6_review_notes_check" CHECK (
      "notes" IS NULL OR length("notes") <= 2000
    ),
    CONSTRAINT "CN6_reviewer_check" CHECK (length(btrim("reviewerUserId")) > 0)
);

CREATE UNIQUE INDEX "CreatorContentVersion_fingerprint_key"
  ON "CreatorContentVersion"("fingerprint");
CREATE UNIQUE INDEX "CreatorContentVersion_contentId_version_key"
  ON "CreatorContentVersion"("contentId", "version");
CREATE INDEX "CN6_version_content_status_idx"
  ON "CreatorContentVersion"("contentId", "status", "version");
CREATE INDEX "CN6_version_asset_status_idx"
  ON "CreatorContentVersion"("mediaAssetId", "status");
CREATE UNIQUE INDEX "CN6_one_draft_version_uq"
  ON "CreatorContentVersion"("contentId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "CN6_one_approved_version_uq"
  ON "CreatorContentVersion"("contentId") WHERE "status" = 'APPROVED';

CREATE UNIQUE INDEX "CreatorContentReview_contentVersionId_key"
  ON "CreatorContentReview"("contentVersionId");
CREATE INDEX "CN6_review_decision_idx"
  ON "CreatorContentReview"("decision", "reviewedAt");
CREATE INDEX "CN6_review_reviewer_idx"
  ON "CreatorContentReview"("reviewerUserId", "reviewedAt");

ALTER TABLE "CreatorContentVersion"
  ADD CONSTRAINT "CN6_version_content_fk"
  FOREIGN KEY ("contentId") REFERENCES "CreatorContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorContentVersion"
  ADD CONSTRAINT "CN6_version_media_asset_fk"
  FOREIGN KEY ("mediaAssetId") REFERENCES "CreatorMediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorContentReview"
  ADD CONSTRAINT "CN6_review_version_fk"
  FOREIGN KEY ("contentVersionId") REFERENCES "CreatorContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fail-closed cutover: mappings published before CN6 have no approved editorial version.
-- Preserve every row/history and require an explicit certified republish after CN6 activation.
UPDATE "CreatorExerciseContentMapping"
SET
  "status" = 'UNPUBLISHED',
  "unpublishedAt" = CURRENT_TIMESTAMP,
  "unpublishReason" = 'CN6_CERTIFICATION_REQUIRED'
WHERE "status" = 'PUBLISHED';

CREATE OR REPLACE FUNCTION "cn6_enforce_mapping_certification"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" = 'PUBLISHED' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "CreatorContent" content
      JOIN "CreatorContentVersion" version
        ON version."contentId" = content."id"
      WHERE content."id" = NEW."contentId"
        AND content."lifecycleStatus" = 'ACTIVE'
        AND version."status" = 'APPROVED'
        AND version."mediaAssetId" = NEW."mediaAssetId"
    ) THEN
      RAISE EXCEPTION 'CN6 certification required for published Exercise Content mapping'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CN6_mapping_certification_trigger"
BEFORE INSERT OR UPDATE OF "status", "contentId", "mediaAssetId"
ON "CreatorExerciseContentMapping"
FOR EACH ROW
EXECUTE FUNCTION "cn6_enforce_mapping_certification"();
