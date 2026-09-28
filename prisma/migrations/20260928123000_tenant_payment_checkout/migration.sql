-- IRON Macro H2 — tenant-scoped hosted checkout metadata.
-- No CVV/CVC/PAN is stored. Provider credentials remain in Integration Secret Vault.

ALTER TABLE "Charge"
  ADD COLUMN "gatewayProviderCode" TEXT,
  ADD COLUMN "gatewayConnectionId" TEXT,
  ADD COLUMN "gatewayRequestId" TEXT,
  ADD COLUMN "gatewayCheckoutExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Charge_gatewayRequestId_key"
  ON "Charge"("gatewayRequestId")
  WHERE "gatewayRequestId" IS NOT NULL;

CREATE UNIQUE INDEX "Charge_gatewayProviderCode_gatewayChargeId_key"
  ON "Charge"("gatewayProviderCode", "gatewayChargeId")
  WHERE "gatewayProviderCode" IS NOT NULL
    AND "gatewayChargeId" IS NOT NULL;

CREATE INDEX "Charge_gymId_status_idx"
  ON "Charge"("gymId", "status");

CREATE INDEX "Charge_gatewayConnectionId_status_idx"
  ON "Charge"("gatewayConnectionId", "status");

ALTER TABLE "Charge"
  ADD CONSTRAINT "Charge_gatewayConnectionId_fkey"
  FOREIGN KEY ("gatewayConnectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
