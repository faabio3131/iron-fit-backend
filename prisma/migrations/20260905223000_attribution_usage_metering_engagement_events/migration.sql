CREATE TYPE "CreatorUsageDeliveryKind" AS ENUM ('MANAGED_CONTENT', 'EXTERNAL_REFERENCE');
CREATE TYPE "CreatorUsageEventType" AS ENUM ('DELIVERY_RESOLVED', 'CONTENT_OPENED', 'CONTENT_PROGRESS', 'CONTENT_COMPLETED', 'CONTENT_DISMISSED');
CREATE TYPE "CreatorUsageObservationSource" AS ENUM ('SERVER_OBSERVED', 'CLIENT_REPORTED');

CREATE TABLE "CreatorContentAttributionSnapshot" (
  "id" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "contentVersionId" TEXT NOT NULL,
  "rightsGrantVersionId" TEXT NOT NULL,
  "rightsHolderId" TEXT NOT NULL,
  "creatorId" TEXT,
  "creatorDisplayName" TEXT,
  "attributionRequired" BOOLEAN NOT NULL DEFAULT false,
  "attributionText" TEXT,
  "fingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreatorContentAttributionSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorContentUsageSession" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "audienceRole" TEXT NOT NULL,
  "exerciseId" TEXT NOT NULL,
  "resolutionKey" TEXT NOT NULL,
  "deliveryKind" "CreatorUsageDeliveryKind" NOT NULL,
  "mappingId" TEXT,
  "contentId" TEXT,
  "contentVersionId" TEXT,
  "mediaAssetId" TEXT,
  "attributionSnapshotId" TEXT,
  "policyMode" TEXT NOT NULL,
  "externalReferenceSource" TEXT,
  "targetFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreatorContentUsageSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorContentUsageEvent" (
  "id" TEXT NOT NULL,
  "usageSessionId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "eventType" "CreatorUsageEventType" NOT NULL,
  "observationSource" "CreatorUsageObservationSource" NOT NULL,
  "progressPercent" INTEGER,
  "fingerprint" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreatorContentUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreatorContentAttributionSnapshot_fingerprint_key"
  ON "CreatorContentAttributionSnapshot"("fingerprint");
CREATE INDEX "CreatorContentAttributionSnapshot_content_created_idx"
  ON "CreatorContentAttributionSnapshot"("contentId", "createdAt");
CREATE INDEX "CreatorContentAttributionSnapshot_content_version_idx"
  ON "CreatorContentAttributionSnapshot"("contentVersionId");
CREATE INDEX "CreatorContentAttributionSnapshot_rights_version_idx"
  ON "CreatorContentAttributionSnapshot"("rightsGrantVersionId");
CREATE INDEX "CreatorContentAttributionSnapshot_rights_holder_idx"
  ON "CreatorContentAttributionSnapshot"("rightsHolderId");
CREATE INDEX "CreatorContentAttributionSnapshot_creator_created_idx"
  ON "CreatorContentAttributionSnapshot"("creatorId", "createdAt");

CREATE UNIQUE INDEX "CreatorContentUsageSession_gym_actor_resolution_key"
  ON "CreatorContentUsageSession"("gymId", "actorUserId", "resolutionKey");
CREATE INDEX "CreatorContentUsageSession_gym_actor_created_idx"
  ON "CreatorContentUsageSession"("gymId", "actorUserId", "createdAt");
CREATE INDEX "CreatorContentUsageSession_gym_exercise_created_idx"
  ON "CreatorContentUsageSession"("gymId", "exerciseId", "createdAt");
CREATE INDEX "CreatorContentUsageSession_content_created_idx"
  ON "CreatorContentUsageSession"("contentId", "createdAt");
CREATE INDEX "CreatorContentUsageSession_attribution_created_idx"
  ON "CreatorContentUsageSession"("attributionSnapshotId", "createdAt");

CREATE UNIQUE INDEX "CreatorContentUsageEvent_fingerprint_key"
  ON "CreatorContentUsageEvent"("fingerprint");
CREATE UNIQUE INDEX "CreatorContentUsageEvent_session_event_key"
  ON "CreatorContentUsageEvent"("usageSessionId", "eventKey");
CREATE INDEX "CreatorContentUsageEvent_session_observed_idx"
  ON "CreatorContentUsageEvent"("usageSessionId", "observedAt");
CREATE INDEX "CreatorContentUsageEvent_type_observed_idx"
  ON "CreatorContentUsageEvent"("eventType", "observedAt");
CREATE UNIQUE INDEX "CN7_one_delivery_resolved_per_session_uq"
  ON "CreatorContentUsageEvent"("usageSessionId")
  WHERE "eventType" = 'DELIVERY_RESOLVED';
CREATE UNIQUE INDEX "CN7_one_opened_per_session_uq"
  ON "CreatorContentUsageEvent"("usageSessionId")
  WHERE "eventType" = 'CONTENT_OPENED';
CREATE UNIQUE INDEX "CN7_one_terminal_event_per_session_uq"
  ON "CreatorContentUsageEvent"("usageSessionId")
  WHERE "eventType" IN ('CONTENT_COMPLETED', 'CONTENT_DISMISSED');

ALTER TABLE "CreatorContentAttributionSnapshot"
  ADD CONSTRAINT "CN7_attribution_text_check"
  CHECK (
    ("attributionRequired" = false AND "attributionText" IS NULL)
    OR
    ("attributionRequired" = true AND "attributionText" IS NOT NULL AND length(btrim("attributionText")) > 0)
  );

ALTER TABLE "CreatorContentAttributionSnapshot"
  ADD CONSTRAINT "CN7_attribution_fingerprint_check"
  CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "CreatorContentUsageSession"
  ADD CONSTRAINT "CN7_usage_resolution_key_uuid_check"
  CHECK ("resolutionKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

ALTER TABLE "CreatorContentUsageSession"
  ADD CONSTRAINT "CN7_usage_role_check"
  CHECK ("audienceRole" IN ('OWNER', 'MANAGER', 'TRAINER', 'STUDENT'));

ALTER TABLE "CreatorContentUsageSession"
  ADD CONSTRAINT "CN7_usage_policy_mode_check"
  CHECK ("policyMode" IN ('IRON_ONLY', 'IRON_FIRST', 'TENANT_PRIVATE_FIRST'));

ALTER TABLE "CreatorContentUsageSession"
  ADD CONSTRAINT "CN7_usage_target_fingerprint_check"
  CHECK ("targetFingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "CreatorContentUsageSession"
  ADD CONSTRAINT "CN7_usage_delivery_shape_check"
  CHECK (
    (
      "deliveryKind" = 'MANAGED_CONTENT'
      AND "mappingId" IS NOT NULL
      AND "contentId" IS NOT NULL
      AND "contentVersionId" IS NOT NULL
      AND "mediaAssetId" IS NOT NULL
      AND "attributionSnapshotId" IS NOT NULL
      AND "externalReferenceSource" IS NULL
    )
    OR
    (
      "deliveryKind" = 'EXTERNAL_REFERENCE'
      AND "mappingId" IS NULL
      AND "contentId" IS NULL
      AND "contentVersionId" IS NULL
      AND "mediaAssetId" IS NULL
      AND "attributionSnapshotId" IS NULL
      AND "externalReferenceSource" = 'Exercise.videoUrl'
    )
  );

ALTER TABLE "CreatorContentUsageEvent"
  ADD CONSTRAINT "CN7_usage_event_progress_range_check"
  CHECK ("progressPercent" IS NULL OR ("progressPercent" >= 0 AND "progressPercent" <= 100));

ALTER TABLE "CreatorContentUsageEvent"
  ADD CONSTRAINT "CN7_usage_event_semantics_check"
  CHECK (
    ("eventType" = 'DELIVERY_RESOLVED' AND "observationSource" = 'SERVER_OBSERVED' AND "progressPercent" IS NULL)
    OR
    ("eventType" = 'CONTENT_OPENED' AND "observationSource" = 'CLIENT_REPORTED' AND "progressPercent" IS NULL)
    OR
    ("eventType" = 'CONTENT_PROGRESS' AND "observationSource" = 'CLIENT_REPORTED' AND "progressPercent" BETWEEN 1 AND 99)
    OR
    ("eventType" = 'CONTENT_COMPLETED' AND "observationSource" = 'CLIENT_REPORTED' AND "progressPercent" = 100)
    OR
    ("eventType" = 'CONTENT_DISMISSED' AND "observationSource" = 'CLIENT_REPORTED' AND ("progressPercent" IS NULL OR "progressPercent" BETWEEN 0 AND 99))
  );

ALTER TABLE "CreatorContentUsageEvent"
  ADD CONSTRAINT "CN7_usage_event_fingerprint_check"
  CHECK ("fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "CreatorContentAttributionSnapshot"
  ADD CONSTRAINT "CreatorContentAttributionSnapshot_contentId_fkey"
  FOREIGN KEY ("contentId") REFERENCES "CreatorContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorContentAttributionSnapshot"
  ADD CONSTRAINT "CreatorContentAttributionSnapshot_contentVersionId_fkey"
  FOREIGN KEY ("contentVersionId") REFERENCES "CreatorContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorContentAttributionSnapshot"
  ADD CONSTRAINT "CreatorContentAttributionSnapshot_rightsGrantVersionId_fkey"
  FOREIGN KEY ("rightsGrantVersionId") REFERENCES "CreatorRightsGrantVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorContentAttributionSnapshot"
  ADD CONSTRAINT "CreatorContentAttributionSnapshot_rightsHolderId_fkey"
  FOREIGN KEY ("rightsHolderId") REFERENCES "CreatorRightsHolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorContentAttributionSnapshot"
  ADD CONSTRAINT "CreatorContentAttributionSnapshot_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorContentUsageSession"
  ADD CONSTRAINT "CreatorContentUsageSession_mappingId_fkey"
  FOREIGN KEY ("mappingId") REFERENCES "CreatorExerciseContentMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorContentUsageSession"
  ADD CONSTRAINT "CreatorContentUsageSession_contentId_fkey"
  FOREIGN KEY ("contentId") REFERENCES "CreatorContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorContentUsageSession"
  ADD CONSTRAINT "CreatorContentUsageSession_contentVersionId_fkey"
  FOREIGN KEY ("contentVersionId") REFERENCES "CreatorContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorContentUsageSession"
  ADD CONSTRAINT "CreatorContentUsageSession_mediaAssetId_fkey"
  FOREIGN KEY ("mediaAssetId") REFERENCES "CreatorMediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorContentUsageSession"
  ADD CONSTRAINT "CreatorContentUsageSession_attributionSnapshotId_fkey"
  FOREIGN KEY ("attributionSnapshotId") REFERENCES "CreatorContentAttributionSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorContentUsageEvent"
  ADD CONSTRAINT "CreatorContentUsageEvent_usageSessionId_fkey"
  FOREIGN KEY ("usageSessionId") REFERENCES "CreatorContentUsageSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION cn7_reject_append_only_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CN7 append-only records cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CN7_attribution_snapshot_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "CreatorContentAttributionSnapshot"
  FOR EACH ROW EXECUTE FUNCTION cn7_reject_append_only_mutation();

CREATE TRIGGER "CN7_usage_session_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "CreatorContentUsageSession"
  FOR EACH ROW EXECUTE FUNCTION cn7_reject_append_only_mutation();

CREATE TRIGGER "CN7_usage_event_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "CreatorContentUsageEvent"
  FOR EACH ROW EXECUTE FUNCTION cn7_reject_append_only_mutation();
