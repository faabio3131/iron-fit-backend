# IRON-EQ0 — Market Research + Equipment Taxonomy

Status: research baseline for the canonical IRON Equipment Knowledge & Inventory foundation.

## Objective

Replace repetitive gym-by-gym manual equipment definition with a governed, manufacturer-neutral IRON master catalog. A tenant must primarily select which canonical equipment capabilities it owns; manufacturer/model details belong to variants, and a missing device becomes a review candidate rather than silently creating a global record.

## Research method

Research was performed against official commercial catalogs and product category pages from large global and Brazilian manufacturers, plus the current ISO stationary-training safety family. The goal of EQ0 is not to copy model catalogs. It is to identify the durable capability taxonomy underneath them so that a new manufacturer or renamed model does not require a new business concept.

### Primary market sources

1. Life Fitness / Hammer Strength — https://www.lifefitness.com/pt-br
   - Commercial portfolio explicitly separates cardio; selectorized; plate-loaded; racks/rigs/platforms; cables/functional strength; benches; storage; free-weight and mobility/conditioning accessories.
   - Current strength highlights include belt squat, hack squat, glute drive, squat press and multiple cable systems.
2. Panatta — https://www.panattasport.com/en/catalog/
   - Broad catalog with strength, cardio and functional categories; selectorized, plate-loaded, racks/platforms, multifunctional and functional-cage families. The catalog exposes hundreds of variants, reinforcing the need to separate canonical capability from manufacturer model.
3. Matrix Fitness — https://br.matrixfitness.com/
   - Commercial portfolio spans cardio, strength, functional/group training and accessories; current innovations include belt-squat and premium cardio families.
4. Movement Fitness Brasil — https://www.movement.com.br/produtos/profissionais/
   - Brazilian professional portfolio covers cardio, cable stations, strength stations, multi-stations, plate-loaded/free-weight equipment and simulators; the catalog lists a large number of professional items and confirms local naming variants such as esteira, bicicleta horizontal/vertical, remos, estações de cabos and multiestações.
5. Precor — https://www.precor.com/en-US
   - Portfolio covers treadmills/slat-belt treadmills, ellipticals, stair climbers, adaptive-motion trainers, bikes, selectorized, plate-loaded, cable stations, benches/racks and newer glute/belt-squat families.
6. HOIST Fitness — https://www.hoistfitness.com/pages/commercial-strength
   - Commercial lines include selectorized, plate-loaded, free weights, benches/racks, multi-jungle, MotionCage, dual-series and bikes.
7. Concept2 — https://www.concept2.com/
   - Confirms ergometer family as distinct capabilities: RowErg, SkiErg, BikeErg and StrengthErg.
8. Keiser — https://www.keiser.com/fitness-equipment/cardio-training/
   - Confirms commercial indoor cycling, strider/elliptical, total-body/recumbent stepper and connected/pneumatic performance equipment.
9. Rogue Fitness — https://www.roguefitness.com/rogue-catalog
   - Expands the commercial/performance taxonomy beyond fixed machines: barbells, plates, racks, functional trainers, sleds, yokes, kettlebells, dumbbells, medicine/slam balls, sandbags, plyo boxes, ropes, agility, bodyweight/gymnastics and mobility.

### Safety / classification sources

- ISO 20957-1:2024 — https://www.iso.org/standard/81908.html — general safety requirements and classification for stationary training equipment used in clubs, studios, hotels, rehabilitation centres and similar facilities.
- ISO 20957-2:2024 — https://www.iso.org/standard/83392.html — strength-training equipment, including stacked weights and alternative resistance such as hydraulic, pneumatic, electrical, magnetic, springs and externally loaded weights.
- ISO 20957-6:2021 — https://www.iso.org/standard/80969.html — treadmills.
- ISO 20957-8:2017 — https://www.iso.org/standard/70975.html — steppers, stair climbers and climbers.

The IRON catalog stores references to applicable standards as metadata in later blocks; it does not claim a specific product is certified merely because its category is covered by a standard.

## Canonical taxonomy v1

The structured research baseline lives in `data/equipment/equipment-taxonomy.v1.tsv` and contains 165 manufacturer-neutral equipment capabilities across these families:

- CARDIO
- SELECTORIZED_STRENGTH
- PLATE_LOADED
- CABLE_FUNCTIONAL
- RACKS_BENCHES
- FREE_WEIGHTS
- FUNCTIONAL_CONDITIONING
- PILATES_REHAB
- SPECIALIZED_STRENGTH

The taxonomy intentionally contains broad modern capabilities that commonly appear under different commercial names, including motorized and curved/slat-belt treadmills, indoor cycles and air bikes, ellipticals/AMT/ascent trainers, stair climbers, RowErg/SkiErg/BikeErg class devices, selectorized and plate-loaded strength, hack/pendulum/belt/V-squat, glute-drive/hip-thrust, cable jungles, Smith/rack/platform systems, specialty bars, sled/yoke/strongman/functional equipment, Pilates studio equipment and pneumatic/digital/isokinetic strength systems.

## Canonical identity rules

1. A canonical item represents a functional equipment capability, not a brand SKU.
2. Manufacturer, commercial line and model are variants attached in EQ2.
3. Aliases normalize local/common names (`graviton`, `pulley alto`, `banco Scott`, `spin bike`, etc.) without creating duplicate canonical concepts.
4. Gym possession/availability is tenant-scoped and belongs to EQ3; catalog knowledge is global.
5. The active gym cannot create or overwrite a global catalog item.
6. `not found` becomes a governed candidate for review in EQ5.
7. Historical references survive rename/deprecation; catalog items are deactivated/versioned rather than destructively deleted.
8. AI and workout generation may only use equipment that is currently available for the active gym.
9. Exercise mapping belongs to EQ4 and is capability-based; a manufacturer model inherits mappings through its canonical item.
10. Quantity, room/location, maintenance state and optional asset information belong to the gym inventory, not to the global catalog definition.

## Why 165 capabilities instead of copying thousands of SKUs

Official catalogs demonstrate that manufacturers can expose hundreds of products and many near-equivalent variants. Copying every SKU directly would create duplicated business concepts and constant churn. EQ0 therefore creates a normalized capability layer and defers manufacturer/model identity to EQ2. This gives IRON broad market coverage while remaining maintainable as brands launch or discontinue models.

## Research limitations and continuous coverage

No finite list can truthfully guarantee every current and future equipment model worldwide. The initial 165-item baseline is designed to cover the major commercial capability families observed across the researched market. EQ5 makes incompleteness operationally safe by introducing candidate intake, deduplication, governance and controlled catalog promotion. That means a client can report an uncommon device without being forced to manually redefine it as a permanent tenant-specific business concept.

## Downstream architecture

EQ1 — global canonical catalog persisted with explicit migration and additive linkage to the existing tenant `Equipment` model.

EQ2 — manufacturer/model/alias/equivalence registry.

EQ3 — gym inventory selection/onboarding: tenant chooses catalog items, quantity and availability instead of retyping definitions.

EQ4 — canonical equipment ↔ exercise/capability mapping, consumed later by Creator Network and IRON Intelligence.

EQ5 — candidate intake, governance, lifecycle and adversarial/full certification.

Only after EQ0–EQ5 are approved may the Fitness Creator Network implementation begin.