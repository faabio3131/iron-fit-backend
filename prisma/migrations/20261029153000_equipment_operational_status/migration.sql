-- Equipment selection/active status remains independent from maintenance state.
ALTER TABLE "Equipment"
  ADD COLUMN "operationalStatus" TEXT NOT NULL DEFAULT 'OPERATIONAL',
  ADD COLUMN "operationalStatusChangedAt" TIMESTAMP(3);
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_operationalStatus_check"
  CHECK ("operationalStatus" IN ('OPERATIONAL', 'MAINTENANCE', 'OUT_OF_SERVICE'));
