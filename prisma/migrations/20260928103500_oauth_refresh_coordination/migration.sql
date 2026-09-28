-- IRON Macro I4/I8 — OAuth refresh coordination lease/retry metadata.
-- No OAuth access/refresh token is persisted in PostgreSQL.

ALTER TABLE "IntegrationConnection"
  ADD COLUMN "oauthRefreshLeaseOwner" TEXT,
  ADD COLUMN "oauthRefreshLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "oauthRefreshRetryAt" TIMESTAMP(3),
  ADD COLUMN "oauthRefreshFailureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "oauthLastRefreshAt" TIMESTAMP(3);

CREATE INDEX "IntegrationConnection_oauthAccessExpiresAt_oauthRefreshRetryAt_idx"
  ON "IntegrationConnection"("oauthAccessExpiresAt", "oauthRefreshRetryAt");

CREATE INDEX "IntegrationConnection_oauthRefreshLeaseUntil_idx"
  ON "IntegrationConnection"("oauthRefreshLeaseUntil");
