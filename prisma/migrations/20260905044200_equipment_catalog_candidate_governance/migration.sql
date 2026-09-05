-- IRON-EQ5 — Catalog Governance, Candidate Intake + Full Certification
-- Additive migration: preserves canonical catalog, tenant inventory and all legacy Equipment rows.

CREATE TYPE "EquipmentCatalogCandidateStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'MERGED',
  'REJECTED'
);

CREATE TABLE "EquipmentCatalogCandidate" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "proposedName" TEXT NOT NULL,
  "proposedCategory" "EquipmentCatalogCategory",
  "manufacturerName" TEXT,
  "modelName" TEXT,
  "aliases" JSONB,
  "evidenceUrl" TEXT,
  "notes" TEXT,
  "status" "EquipmentCatalogCandidateStatus" NOT NULL DEFAULT 'PENDING',
  "resolvedCatalogItemId" TEXT,
  "reviewNotes" TEXT,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EquipmentCatalogCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquipmentCatalogCandidate_gymId_fingerprint_key"
  ON "EquipmentCatalogCandidate"("gymId", "fingerprint");

CREATE INDEX "EquipmentCatalogCandidate_gymId_status_createdAt_idx"
  ON "EquipmentCatalogCandidate"("gymId", "status", "createdAt");

CREATE INDEX "EquipmentCatalogCandidate_status_createdAt_idx"
  ON "EquipmentCatalogCandidate"("status", "createdAt");

CREATE INDEX "EquipmentCatalogCandidate_resolvedCatalogItemId_idx"
  ON "EquipmentCatalogCandidate"("resolvedCatalogItemId");

ALTER TABLE "EquipmentCatalogCandidate"
  ADD CONSTRAINT "EquipmentCatalogCandidate_gymId_fkey"
  FOREIGN KEY ("gymId") REFERENCES "Gym"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EquipmentCatalogCandidate"
  ADD CONSTRAINT "EquipmentCatalogCandidate_submittedByUserId_fkey"
  FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EquipmentCatalogCandidate"
  ADD CONSTRAINT "EquipmentCatalogCandidate_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EquipmentCatalogCandidate"
  ADD CONSTRAINT "EquipmentCatalogCandidate_resolvedCatalogItemId_fkey"
  FOREIGN KEY ("resolvedCatalogItemId") REFERENCES "EquipmentCatalogItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
