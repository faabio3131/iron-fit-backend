# IRON FIT CORE — cotas mensais de IA / rollout

Status: **CANDIDATE — NOT PRODUCTION ACTIVE** (2026-11-09).
Authority: IRON ProductEntitlements (quota) + FM Command (payment/checkout) + IRON AI runtime (execution).
No AI unlimited offering is permitted. Existing immutable published plan versions must not be modified in-place.

## Commercial candidates

| Code | Workout candidates per month | Other advisory AI actions per month |
| --- | ---: | ---: |
| IRON_START | 50 | 100 |
| IRON_GROWTH | 200 | 400 |
| IRON_SCALE | 500 | 1000 |
| IRON_ENTERPRISE | 1200 | 2500 |

These are **candidate** limits, not published/subscribed benefits. Source:
`config/commercial/iron-four-tiers-2026.candidate.json`.
Existing launch plans `IRON_V1_TRIAL` and `IRON_V1` version 1 were NOT modified.
For any rollout, create and publish new immutable ProductPlanVersion(s) with
`ai.workout_monthly_max` and `ai.advisory_monthly_max` LIMIT entitlements,
then migrate active tenants via the canonical FM Command/IRON subscription lifecycle.
Never alter a published entitlement in place or silently disable existing clients.

## Extra workout packs (CANDIDATE / checkout NOT ENABLED)

| Package code | Units | Suggested BRL price |
| --- | ---: | ---: |
| IRON_AI_WORKOUT_100 | 100 | 19.90 |
| IRON_AI_WORKOUT_300 | 300 | 49.90 |
| IRON_AI_WORKOUT_1000 | 1000 | 129.90 |

Package **prices** and financially valid paid invoices belong to FM Command.
IRON recognizes fixed package identifiers and quantities, and accepts a granted
credit ONLY from its existing guarded FM Command S2S interface after
Command verifies a canonical paid invoice. It records one immutable sourceInvoiceId,
full tenant scope, period and audit trail. Refund/reversal revokes the grant.
No checkout button may be offered before checkout -> signed webhook -> verified
invoice -> retryable S2S grant is actually implemented and tested.

Non-rollover monthly cycle: use current billing cycle when present; otherwise
UTC anniversary anchored to the active canonical subscription (month-end clamp).
Extra credits expire with that same cycle. API `GET /api/v1/ai/quota` returns
counts for the tenant's authorized staff, including 70/90/100 percent alert thresholds.
`AiMonthlyConsumption` is a commercial ledger; `AiProviderAttempt` remains
the separately audited provider-token/cost ledger (provider retries are not extra
commercial requests). Completed provider requests consume quota; failures release it.
**Open engineering gap**: downstream rejected candidates after successful provider
execution should be reconciled so users do not lose a credit for unusable output.

## Release gates

1. Publish new immutable plan version and provision/migrate tenant rights without legacy regressions.
2. FM Command implements checkout & verified payments (Cakto/other approved provider), packages and outbox with idempotent grant/revoke; configure official offers.
3. Web displays actual live quota; block false purchase CTA until checkout works.
4. Postgres fresh migration, active tenant isolation, same-ID replay, concurrent limits,
   refund/reversal, provider retry/failure and two-tenant end-to-end tests pass.
5. Server-side financial/AI hard limit, accounting reconciled with FM Command; security and CI green.
6. No production claim until real provider authorization, payment and production smoke are validated.

Do not merge/deploy as full commercial feature until these gates are met.
