# IRON — Macro K2-K4 — Provider Classification

Status: **K2 OUT for V1; K3/K4 BLOCKED_EXTERNAL with internal fail-closed architecture preserved.**

This document reconciles the current implementation with the approved IRON V1 Launch Matrix. It does not change the launch decision and does not promote any external provider.

## K2 — Creator / Storage / CDN

The Launch Matrix explicitly classifies both Creator Network commercial capabilities as OUT for V1:

- `creator.iron_managed` / `content.iron_managed`;
- `creator.tenant_private` / `content.tenant_private`.

Therefore K2 is not a launch dependency.

The existing Creator Network domain remains in the codebase as roadmap architecture, but the V1 launch offerings do not grant either feature.

No storage/CDN provider, signed-delivery provider or tenant-private storage credential is to be activated merely because the internal Creator domain exists.

K2 V1 status: **OUT / feature-off by Launch Matrix**.

## K3 — Wellhub

The Launch Matrix classifies `provider.wellhub` as **EXTERNAL_BLOCKER**.

The existing Aggregator Hub adapter remains provider-neutral/fail-closed when a real partner transport is absent or the connection is not physically homologated.

K3 requires external evidence before any commercial activation:

1. official Wellhub integration documentation/contract;
2. authorized account/application;
3. tenant-scoped credentials via IntegrationConnection + Vault;
4. real transport implementation from the official contract;
5. location/account binding;
6. TTL/rate-limit behavior;
7. webhook/security behavior when applicable;
8. controlled eligibility/visit tests;
9. physical homologation evidence.

Until then, the capability must not be advertised as available.

## K4 — TotalPass

The Launch Matrix classifies `provider.totalpass` as **EXTERNAL_BLOCKER**.

The existing adapter records UNKNOWN/fail-closed provider evidence when the connection is not homologated, partner transport is unavailable or provider evidence is invalid.

K4 requires external evidence before commercial activation:

1. official TotalPass integration documentation/contract;
2. authorized account/application;
3. tenant-scoped credentials via IntegrationConnection + Vault;
4. real transport implementation;
5. connection/location binding;
6. retry and provider-unavailability behavior;
7. controlled eligibility/visit tests;
8. physical homologation evidence.

Until then, the capability must not be advertised as available.

## Gate boundary

Internal CI may certify that:

- K2 remains OUT in the canonical launch manifest;
- V1 offerings do not grant K2 feature keys;
- K3/K4 remain EXTERNAL_BLOCKER;
- current adapters fail closed without real partner transport/homologation.

CI cannot convert Wellhub/TotalPass to LAUNCH or homologated status without external evidence.
