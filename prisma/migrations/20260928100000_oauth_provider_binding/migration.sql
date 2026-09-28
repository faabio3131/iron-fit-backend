-- IRON Macro I2/I3 — bind tenant OAuth credential to the canonical GLOBAL OAuth App.
-- Only non-secret metadata is persisted. Access/refresh tokens remain exclusively in Integration Secret Vault.

ALTER TABLE "IntegrationConnection"
  ADD COLUMN "oauthAppConnectionId" TEXT,
  ADD COLUMN "oauthAccessExpiresAt" TIMESTAMP(3),
  ADD COLUMN "oauthGrantedScopes" JSONB,
  ADD COLUMN "oauthRefreshCapable" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "IntegrationConnection_oauthAppConnectionId_idx"
  ON "IntegrationConnection"("oauthAppConnectionId");

ALTER TABLE "IntegrationConnection"
  ADD CONSTRAINT "IntegrationConnection_oauthAppConnectionId_fkey"
  FOREIGN KEY ("oauthAppConnectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
