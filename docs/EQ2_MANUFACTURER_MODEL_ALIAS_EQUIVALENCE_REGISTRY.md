# IRON-EQ2 — Manufacturer, Model, Alias & Equivalence Registry

## Objective

Give IRON a governed vocabulary for brands, commercial models and naming variants without turning a manufacturer SKU into the business identity of an equipment capability.

## Canonical rule

`EquipmentCatalogItem` remains the functional truth. Manufacturer/model is evidence that a commercial product implements one canonical capability.

Two commercial models are functionally equivalent for IRON when they map to the same canonical capability. This avoids an unmaintainable pairwise equivalence graph.

Example:

`Life Fitness Integrity+ Treadmill` -> `treadmill_motorized`

A future treadmill model from another manufacturer can map to the same capability without duplicating exercise mappings, AI rules or tenant inventory semantics.

## Governed registries

- `data/equipment/manufacturers.v1.tsv` — verified manufacturer identity and official site.
- `data/equipment/equipment-model-registry.v1.tsv` — verified model-to-capability mappings with source URL.
- `data/equipment/equipment-taxonomy.v1.tsv` — EQ0 canonical item plus semicolon-separated common aliases.

Aliases are normalized from the EQ0 taxonomy rather than being promoted to independent canonical items. The resolver must compare normalized text (case/diacritic/punctuation-insensitive) but the stored display form remains human-readable.

## Initial manufacturer coverage

The governed v1 registry includes Life Fitness, Hammer Strength, Panatta, Matrix Fitness, Movement Fitness, Precor, HOIST Fitness, Concept2, Keiser and Rogue Fitness. This is not represented as a claim that only these manufacturers exist. New manufacturers are admitted through controlled governance, not tenant-local free text becoming global truth.

## Model coverage policy

EQ2 intentionally does not copy every manufacturer SKU. Model churn is much faster than functional capability churn. The initial verified examples prove the mapping contract. Model coverage expands continuously from official manufacturer evidence and later EQ5 candidate review.

Every model record must:

1. reference a manufacturer slug present in the manufacturer registry;
2. reference a canonical item ID present in the approved EQ0 taxonomy;
3. carry a source URL from the manufacturer or another approved primary source;
4. never carry `gymId` or tenant ownership;
5. never create a new functional capability merely because a marketing name is different.

## Alias and equivalence behavior

- `graviton` can resolve to `sel_assisted_chin_dip` without creating a second capability;
- `pulley alto` can resolve to `sel_lat_pulldown`;
- `spin bike` can resolve to `bike_indoor_cycle`;
- a commercial model linked to `row_ergometer` inherits the canonical exercise/capability semantics created later in EQ4;
- ambiguous aliases must fail closed into candidate/review instead of guessing.

## Persistence boundary

EQ1 created the durable global capability domain. EQ2 defines the governed manufacturer/model/alias/equivalence source registry and validation contract. The customer-facing onboarding does not need manufacturer/model selection to function; EQ3 persists the 165 canonical items and lets a gym select those capabilities. Manufacturer/model enrichment remains optional metadata for inventory and can evolve without blocking catalog selection.

No schema migration is required in EQ2 because no tenant or canonical capability identity changes. A future normalized manufacturer/model table should only be introduced when operational queries require it, with an explicit migration under the same governance rules.

## Downstream

- EQ3: bootstrap canonical catalog + tenant equipment selection/onboarding.
- EQ4: exercise ↔ canonical capability mapping.
- EQ5: candidate intake, ambiguous alias handling and governance/certification.
