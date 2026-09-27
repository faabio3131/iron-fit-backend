-- IRON Commercial Readiness — C8 lifecycle metadata.
-- Secret values remain outside PostgreSQL.

ALTER TABLE "IntegrationConnection"
  ADD COLUMN "secretVersion" INTEGER,
  ADD COLUMN "secretRotatedAt" TIMESTAMP(3),
  ADD COLUMN "secretExpiresAt" TIMESTAMP(3),
  ADD COLUMN "secretLastUsedAt" TIMESTAMP(3),
  ADD COLUMN "secretRevokedAt" TIMESTAMP(3);

ALTER TABLE "IntegrationConnection"
  ADD CONSTRAINT "IntegrationConnection_secret_version_positive"
  CHECK ("secretVersion" IS NULL OR "secretVersion" > 0);

ALTER TABLE "IntegrationConnection"
  ADD CONSTRAINT "IntegrationConnection_secret_metadata_shape"
  CHECK (
    (
      "secretReference" IS NULL
      AND "secretVersion" IS NULL
      AND "secretRotatedAt" IS NULL
      AND "secretExpiresAt" IS NULL
      AND "secretLastUsedAt" IS NULL
      AND "secretRevokedAt" IS NULL
    )
    OR
    (
      "secretReference" IS NOT NULL
      AND "secretVersion" IS NOT NULL
      AND "secretRotatedAt" IS NOT NULL
    )
  );

ALTER TABLE "IntegrationConnection"
  ADD CONSTRAINT "IntegrationConnection_secret_expiry_after_rotation"
  CHECK (
    "secretExpiresAt" IS NULL
    OR "secretRotatedAt" IS NULL
    OR "secretExpiresAt" > "secretRotatedAt"
  );
