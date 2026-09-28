-- IRON Macro J2/J3 — governed FM Fiscal Bridge binding and dispatch lease.
-- Workload bearer secrets remain exclusively in Integration Secret Vault.

CREATE TABLE "FiscalScopeBinding" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "environment" "IntegrationEnvironment" NOT NULL,
  "externalTenantId" TEXT NOT NULL,
  "externalUnitId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FiscalScopeBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalScopeBinding_gymId_environment_key"
  ON "FiscalScopeBinding"("gymId", "environment");

CREATE INDEX "FiscalScopeBinding_environment_active_idx"
  ON "FiscalScopeBinding"("environment", "active");

ALTER TABLE "FiscalScopeBinding"
  ADD CONSTRAINT "FiscalScopeBinding_gymId_fkey"
  FOREIGN KEY ("gymId") REFERENCES "Gym"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FiscalHandoff"
  ADD COLUMN "bridgeConnectionId" TEXT,
  ADD COLUMN "dispatchLeaseOwner" TEXT,
  ADD COLUMN "dispatchLeaseUntil" TIMESTAMP(3);

CREATE INDEX "FiscalHandoff_dispatchLeaseUntil_idx"
  ON "FiscalHandoff"("dispatchLeaseUntil");

CREATE INDEX "FiscalHandoff_bridgeConnectionId_status_idx"
  ON "FiscalHandoff"("bridgeConnectionId", "status");

ALTER TABLE "FiscalHandoff"
  ADD CONSTRAINT "FiscalHandoff_bridgeConnectionId_fkey"
  FOREIGN KEY ("bridgeConnectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
