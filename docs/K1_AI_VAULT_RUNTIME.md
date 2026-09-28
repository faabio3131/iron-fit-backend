# IRON — Macro K1 — AI Provider / Vault Runtime

Status: **CANDIDATE — internal provider-neutral K1 runtime implemented. Real AI provider/model/credential homologation remains BLOCKED_EXTERNAL.**

## Launch decision

The approved IRON V1 Launch Matrix keeps these capabilities in LAUNCH:

- `ai.workout_generation`;
- `ai.content_recommendation`.

K1 therefore cannot be closed as OUT. A real provider/model must ultimately be configured and homologated.

## Canonical configuration authority

`AiConfigurationProfile` remains the provider/model/limits policy authority and preserves TENANT -> GLOBAL precedence.

A profile may define:

- capability;
- providerCode;
- modelCode;
- HTTPS endpoint;
- region;
- timeout;
- budgetUnits;
- fallback policy;
- opaque `secretReference`.

K1 does not hardcode a commercial AI vendor or model because none is yet selected by current evidence.

## Secret authority

The previous AI0 placeholder validated a secret reference but intentionally had no real secret backend.

K1 connects that boundary to the canonical Integration & Secret Vault architecture.

An ACTIVE external AI profile with a secret reference resolves only when an `IntegrationConnection` exists with all of the following matching facts:

- same providerCode;
- same runtime environment;
- same GLOBAL/TENANT scope;
- same tenant when TENANT;
- same opaque `secretReference`;
- matching AI capability;
- ACTIVE credential lifecycle.

The final secret is then resolved through `IntegrationSecretResolverService.resolveForExternalBoundary(...)`.

AI never reads the Vault directly and never accepts a secret value in the request.

## Capability mapping

AI contract capabilities map to IntegrationConnection capabilities as follows:

- `WORKOUT_INSIGHTS` -> `ai.workout_insights`;
- `ADVISORY_CHAT` -> `ai.advisory_chat`;
- `WORKOUT_GENERATION` -> `ai.workout_generation`;
- `CONTENT_RECOMMENDATION` -> `ai.content_recommendation`.

This prevents a credential connected for one AI capability from being silently reused for another.

## Provider runtime boundary

Provider adapters may declare `requiresCredential=true`.

Before such an adapter executes:

1. tenant/profile scope is validated;
2. the canonical IntegrationConnection is resolved;
3. the Vault secret is resolved only at the external execution boundary;
4. the adapter receives an `IntegrationSecretValue`, whose logs/JSON/string representation are redacted.

Missing, revoked, expired, ambiguous or cross-tenant credentials fail closed.

Unknown providers continue to resolve to the Null Provider and perform no network request.

## Limits and costs

`budgetUnits` remains the K1 configuration-level execution guard.

A value of zero blocks execution before the provider boundary.

Provider-specific token accounting, price tables and billing telemetry must be implemented only after the actual provider/model contract is selected; K1 does not invent vendor pricing.

## BLOCKED_EXTERNAL

The following evidence is still required before K1 can be declared physically homologated:

1. real AI provider selected;
2. real model(s) selected for the LAUNCH capabilities;
3. provider adapter implemented from the official API contract;
4. real GLOBAL and/or TENANT IntegrationConnection configured;
5. credential stored in the real Vault;
6. controlled HOMOLOG executions for workout generation/content recommendation;
7. timeout/rate-limit/bad-credential tests against the real provider;
8. measured usage/cost limits;
9. proof of secret redaction in real logs/traces;
10. quality/safety acceptance for provider outputs.

Internal CI certifies provider neutrality, tenant isolation, Vault binding and fail-closed behavior only.
