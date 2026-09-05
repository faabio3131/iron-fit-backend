# IRON-EQ1 — Canonical Equipment Catalog Domain + migrations

## Baseline

`main @ 144301901f90d460d777dc6e838df215ba02ae0a` (EQ0 promoted).

## Goal

Persist the global IRON equipment knowledge layer without destroying or reinterpreting the already-certified tenant `Equipment` inventory and `WorkoutExercise.equipmentId` references.

## Domain split

### `EquipmentCatalogItem` — global IRON knowledge

A catalog item represents one manufacturer-neutral functional capability discovered in EQ0. It is not owned by a gym.

Fields include stable `slug`, canonical `name`, `EquipmentCatalogCategory`, aliases and optional structured biomechanical/safety metadata. Global catalog lifecycle uses `active`; historical references must not require destructive deletion.

### `Equipment` — tenant inventory compatibility layer

The existing `Equipment` model remains gym-scoped and continues to be the object referenced by workouts. EQ1 adds nullable `catalogItemId` so old records remain valid while new catalog-selected inventory can point to the canonical global definition.

`@@unique([gymId, catalogItemId])` prevents one gym from selecting the same canonical item twice while PostgreSQL still permits multiple legacy rows with `catalogItemId = NULL`.

Deletion of a catalog item is not the normal lifecycle. The foreign key is `SET NULL` defensively; governed catalog deactivation/deprecation is the intended process.

## Migration

`20260904234500_canonical_equipment_catalog_domain` is additive:

- creates `EquipmentCatalogCategory`;
- creates `EquipmentCatalogItem`;
- adds nullable `Equipment.catalogItemId`;
- creates category/active, catalog relation and gym/catalog uniqueness indexes;
- adds the FK to the global catalog;
- does not delete, rewrite or backfill legacy equipment rows.

## EQ0 data and persistence boundary

The researched 165-capability taxonomy remains the approved source dataset in `data/equipment/equipment-taxonomy.v1.tsv`. EQ1 creates the durable schema. The controlled bootstrap/upsert of that approved dataset into the catalog, together with the tenant selection/onboarding runtime, is performed in EQ3 so catalog population and selection are delivered atomically rather than relying on an ad-hoc migration-time filesystem read.

## Invariants

1. Catalog knowledge is global and has no `gymId`.
2. Tenant inventory always retains `gymId`.
3. Legacy tenant equipment remains valid without catalog linkage.
4. New catalog selection must be unique per `(gymId, catalogItemId)`.
5. No client-supplied tenant can create or mutate global catalog knowledge.
6. Manufacturer/model identity is deliberately deferred to EQ2.
7. Exercise/capability mapping is deliberately deferred to EQ4.
8. Candidate intake and global catalog governance are deliberately deferred to EQ5.
9. No Creator Network or AI runtime is introduced in EQ1.
