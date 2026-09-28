-- IRON Macro I2/I3/I4 — OAuth tenant token lifecycle metadata.
-- Access/refresh tokens remain exclusively in Integration Secret Vault.

CREATE TABLE "IntegrationOAuthTokenState" (
  "connectionId" TEXT NOT NULL,
  "appConnectionId" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "environment" "IntegrationEnvironment" NOT NULL,
  "tokenType" TEXT,
  "grantedScopes" JSONB NOT NULL,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "refreshAvailable" BOOLEAN NOT NULL DEFAULT false,
  "refreshGeneration" INTEGER NOT NULL DEFAULT 0,
  "refreshLeaseHash" TEXT,
  "refreshLeaseUntil" TIMESTAMP(3),
  "lastRefreshAt" TIMESTAMP(3),
  "reauthRequiredAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationOAuthTokenState_pkey" PRIMARY KEY ("connectionId"),
  CONSTRAINT "IntegrationOAuthTokenState_refresh_generation_nonnegative"
    CHECK ("refreshGeneration" >= 0),
  CONSTRAINT "IntegrationOAuthTokenState_refresh_lease_shape"
    CHECK (
      ("refreshLeaseHash" IS NULL AND "refreshLeaseUntil" IS NULL)
      OR
      ("refreshLeaseHash" IS NOT NULL AND "refreshLeaseUntil" IS NOT NULL)
    )
);

CREATE INDEX "IntegrationOAuthTokenState_appConnectionId_idx"
  ON "IntegrationOAuthTokenState"("appConnectionId");
CREATE INDEX "IntegrationOAuthTokenState_providerCode_environment_idx"
  ON "IntegrationOAuthTokenState"("providerCode", "environment");
CREATE INDEX "IntegrationOAuthTokenState_accessTokenExpiresAt_idx"
  ON "IntegrationOAuthTokenState"("accessTokenExpiresAt");
CREATE INDEX "IntegrationOAuthTokenState_refreshLeaseUntil_idx"
  ON "IntegrationOAuthTokenState"("refreshLeaseUntil");

ALTER TABLE "IntegrationOAuthTokenState"
  ADD CONSTRAINT "IntegrationOAuthTokenState_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
