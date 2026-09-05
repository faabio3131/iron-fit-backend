-- IRON-EQ1 — Canonical Equipment Catalog Domain
-- Additive migration: preserves all legacy tenant Equipment rows and WorkoutExercise references.

CREATE TYPE "EquipmentCatalogCategory" AS ENUM (
  'CARDIO',
  'SELECTORIZED_STRENGTH',
  'PLATE_LOADED',
  'CABLE_FUNCTIONAL',
  'RACKS_BENCHES',
  'FREE_WEIGHTS',
  'FUNCTIONAL_CONDITIONING',
  'PILATES_REHAB',
  'SPECIALIZED_STRENGTH'
);

CREATE TABLE "EquipmentCatalogItem" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" "EquipmentCatalogCategory" NOT NULL,
  "aliases" JSONB,
  "primaryMuscle" TEXT,
  "secondaryMuscles" JSONB,
  "movementPatterns" JSONB,
  "contraindications" JSONB,
  "metadata" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EquipmentCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquipmentCatalogItem_slug_key"
  ON "EquipmentCatalogItem"("slug");

CREATE INDEX "EquipmentCatalogItem_category_active_idx"
  ON "EquipmentCatalogItem"("category", "active");

ALTER TABLE "Equipment"
  ADD COLUMN "catalogItemId" TEXT;

CREATE INDEX "Equipment_catalogItemId_idx"
  ON "Equipment"("catalogItemId");

CREATE UNIQUE INDEX "Equipment_gymId_catalogItemId_key"
  ON "Equipment"("gymId", "catalogItemId");

ALTER TABLE "Equipment"
  ADD CONSTRAINT "Equipment_catalogItemId_fkey"
  FOREIGN KEY ("catalogItemId") REFERENCES "EquipmentCatalogItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
