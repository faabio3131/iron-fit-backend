-- IRON Macro I1/I5 — OAuth authorization state bound to canonical connection/session.
-- Raw state and PKCE verifier are never stored in PostgreSQL.

CREATE TABLE "IntegrationOAuthAuthorizationAttempt" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "appConnectionId" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "environment" "IntegrationEnvironment" NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "capabilities" JSONB NOT NULL,
  "scopes" JSONB NOT NULL,
  "pkceMode" TEXT NOT NULL,
  "pkceSecretReference" TEXT,
  "pkceSecretVersion" INTEGER,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationOAuthAuthorizationAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationOAuthAuthorizationAttempt_state_hash_shape"
    CHECK ("stateHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "IntegrationOAuthAuthorizationAttempt_pkce_mode"
    CHECK ("pkceMode" IN ('S256','NONE')),
  CONSTRAINT "IntegrationOAuthAuthorizationAttempt_pkce_shape"
    CHECK (
      (
        "pkceMode" = 'S256'
        AND "pkceSecretReference" IS NOT NULL
        AND "pkceSecretVersion" IS NOT NULL
        AND "pkceSecretVersion" > 0
      )
      OR
      (
        "pkceMode" = 'NONE'
        AND "pkceSecretReference" IS NULL
        AND "pkceSecretVersion" IS NULL
      )
    )
);

CREATE UNIQUE INDEX "IntegrationOAuthAuthorizationAttempt_stateHash_key"
  ON "IntegrationOAuthAuthorizationAttempt"("stateHash");
CREATE UNIQUE INDEX "IntegrationOAuthAuthorizationAttempt_pkceSecretReference_key"
  ON "IntegrationOAuthAuthorizationAttempt"("pkceSecretReference")
  WHERE "pkceSecretReference" IS NOT NULL;
CREATE INDEX "IntegrationOAuthAuthorizationAttempt_connectionId_expiresAt_idx"
  ON "IntegrationOAuthAuthorizationAttempt"("connectionId", "expiresAt");
CREATE INDEX "IntegrationOAuthAuthorizationAttempt_sessionId_expiresAt_idx"
  ON "IntegrationOAuthAuthorizationAttempt"("sessionId", "expiresAt");
CREATE INDEX "IntegrationOAuthAuthorizationAttempt_providerCode_environment_idx"
  ON "IntegrationOAuthAuthorizationAttempt"("providerCode", "environment");

ALTER TABLE "IntegrationOAuthAuthorizationAttempt"
  ADD CONSTRAINT "IntegrationOAuthAuthorizationAttempt_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
