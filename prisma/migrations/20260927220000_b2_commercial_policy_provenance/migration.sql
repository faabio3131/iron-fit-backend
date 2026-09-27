-- IRON Macro B2 — commercial policy provenance for zero-deploy trial configuration.

ALTER TABLE "CommercialTrialProvisioning"
  ADD COLUMN "launchMatrixVersion" INTEGER,
  ADD COLUMN "launchSnapshotHash" TEXT;

ALTER TABLE "CommercialTrialProvisioning"
  ADD CONSTRAINT "CommercialTrialProvisioning_launch_matrix_version"
    CHECK ("launchMatrixVersion" IS NULL OR "launchMatrixVersion" > 0),
  ADD CONSTRAINT "CommercialTrialProvisioning_launch_snapshot_hash"
    CHECK (
      "launchSnapshotHash" IS NULL
      OR "launchSnapshotHash" ~ '^[a-f0-9]{64}$'
    ),
  ADD CONSTRAINT "CommercialTrialProvisioning_launch_provenance_shape"
    CHECK (
      ("launchMatrixVersion" IS NULL AND "launchSnapshotHash" IS NULL)
      OR
      ("launchMatrixVersion" IS NOT NULL AND "launchSnapshotHash" IS NOT NULL)
    );

CREATE INDEX "CommercialTrialProvisioning_launchMatrixVersion_idx"
  ON "CommercialTrialProvisioning"("launchMatrixVersion");
