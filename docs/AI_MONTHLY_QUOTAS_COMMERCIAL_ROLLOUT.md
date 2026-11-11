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
| IRON_ENTERPRISE | 750 | 2500 |

These are **candidate** limits, not published/subscribed benefits. Source:
`config/commercial/iron-four-tiers-2026.candidate.json`.
Existing launch plans `IRON_V1_TRIAL` and `IRON_V1` version 1 were NOT modified.
For the exact immutable historical v1 subscriptions only, the AI runtime maintains a
**bounded compatibility allowance** per month: `IRON_V1_TRIAL` 10 workout / 20
advisory and `IRON_V1` 50 workout / 100 advisory. This requires the underlying
canonical AI feature entitlement to remain effectively enabled for that tenant;
disabled capabilities, unrecognized plans and any later plan version fail closed.
It does not publish or mutate any old entitlement nor permit unlimited usage.
No existing subscription is auto-migrated for the sake of new quota fields.
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
**Implemented internally, not externally homologated**: after successful provider
execution, a workout candidate rejected by advisory/domain validation releases
only the consumed reservation identified by the original
`tenantId + WORKOUT + requestId + periodStart`. The service never derives this
billing-cycle identifier from the wall clock during rejection, preventing
cross-month releases when a request ID is reused. The permanent regression
`test/ai-workout-quota-rejected.test.mjs` covers same-ID reuse across months,
cross-tenant and cross-group isolation, missing-period fail-closed behavior,
reservation period propagation, and both rejection branches. The presence of
code and regression does **not** demonstrate real provider execution or
production homologation.

## Release gates

1. Publish new immutable plan version and provision/migrate tenant rights without legacy regressions.
2. FM Command implements checkout & verified payments (Cakto/other approved provider), packages and outbox with idempotent grant/revoke; configure official offers.
3. Web displays actual live quota; block false purchase CTA until checkout works.
4. Postgres fresh migration, active tenant isolation, same-ID replay, concurrent limits,
   refund/reversal, provider retry/failure and two-tenant end-to-end tests pass.
5. Server-side financial/AI hard limit, accounting reconciled with FM Command; security and CI green.
6. No production claim until real provider authorization, payment and production smoke are validated.

Do not merge/deploy as full commercial feature until these gates are met.

## Contabo production operator gate (protected, not auto-enabled)

The PROD Docker image now carries only the approved read-only-by-default rollout
tool and its public candidate manifest. **No tenant, checkout, payment, or historic
subscription is touched by image deployment.** The runbook lives in
`ops/contabo/publish-four-tiers.sh` and must be run on the existing Contabo host,
not in a new application.

After GitHub `production` promotion and successful deployment, inspect:
```bash
cd /opt/fm/ironfit
bash src/backend/ops/contabo/deploy.sh status
bash src/backend/ops/contabo/publish-four-tiers.sh --check
```
The --check command verifies current checkout SHA, readiness of API and Web,
backend build identity, complete Prisma migrations, published legacy baseline and
the exact four planned changes **without writing anything**.

Only after a named authorized global SUPER_ADMIN is verified, operator approval
is recorded and a successful backup can be created:
```bash
export IRON_AI_QUOTA_ROLLOUT_APPROVED=YES
export IRON_AI_QUOTA_ACTOR_USER_ID='<existing-global-SUPER_ADMIN-UUID>'
bash src/backend/ops/contabo/publish-four-tiers.sh --apply
unset IRON_AI_QUOTA_ROLLOUT_APPROVED IRON_AI_QUOTA_ACTOR_USER_ID
```
The apply script revalidates deployment, migration state and the actor via the
canonical userRole table, takes a SHA256-verified backup and publishes immutable
versions through ProductEntitlements. It then performs a read-only verification
that exactly four tiers are CURRENT_ALREADY_COMPLIANT, with zero subscription
transitions and no historical plan version mutation.

Never infer the actor UUID or turn a candidate plan into a paid subscription
manually. FM Command remains the sole billing authority; Cakto sales remain
disabled until verified provider credentials, offer IDs, signed webhook and
authorized payment are independently homologated. A successful offline/PostgreSQL
CI or publication in a local test database is not production certification.
