# IRON — Macro M — Operations / SRE / Support

Status: **CANDIDATE — internal runbooks defined. Real owners, alert routes, runtime and drills remain BLOCKED_EXTERNAL.**

## M1 — Support

Required operating model:

- one accountable support owner for IRON V1;
- one customer-facing support channel;
- one internal escalation channel;
- published support hours;
- ticket identifiers preserved across escalation;
- incidents and security/privacy requests routed to their dedicated workflows.

No support owner or channel is invented by source code. The gate remains blocked until those values are assigned and tested.

## M2 — Severity model

- **SEV0** — active security, privacy, cross-tenant, secret/card exposure, or broad production compromise. Stop-ship / immediate containment.
- **SEV1** — critical customer journey unavailable for multiple customers or payment/authentication outage with no safe workaround.
- **SEV2** — major degradation or single-domain/provider failure with bounded workaround.
- **SEV3** — minor degradation, defect or operational issue without material service interruption.

Severity can only be lowered from evidence, never to meet release dates.

## M3 — Incident response

Minimum sequence:

1. detect / receive incident;
2. assign incident owner;
3. classify severity;
4. preserve evidence and timestamps;
5. contain unsafe traffic or provider integration;
6. communicate status through the approved channel;
7. recover using the known-safe path;
8. verify health/readiness and key customer journeys;
9. close only after monitoring is stable;
10. record post-incident review and follow-up actions.

SEV0/SEV1 events block release until resolved or explicitly accepted by the authorized release authority.

## M4 — Deploy / rollback

Every deployment must identify backend SHA, app SHA where applicable, schema/migration state, release version, environment, pre-deploy health, migration compatibility, rollback target and post-deploy smoke result.

Rollback must not blindly reverse irreversible database migrations. If schema rollback is unsafe, application rollback must use a compatibility plan or forward-fix.

A real rollback drill is required before the production gate.

## M5 — Provider outage

Provider outages must not change source-of-truth boundaries.

- OAuth/provider outage: preserve local connection state and fail external actions safely.
- e-mail outage: queue/retry according to bounded delivery policy.
- payment outage: never synthesize payment success; preserve idempotency and reconcile.
- fiscal outage: preserve durable handoff and reconcile before retrying unknown outcomes.
- AI outage: use approved fallback only; no silent provider/secret substitution.
- Wellhub/TotalPass remain EXTERNAL_BLOCKER unless officially integrated.

Provider contacts/status sources must be recorded from real providers before go-live.

## M6 — Monitoring / alerts

The backend already exposes authenticated runtime metrics and health/readiness probes.

Minimum real monitoring must collect liveness/readiness, request volume, 5xx count/rate, latency trend/max, memory/CPU/container health, database connectivity/pool health, provider failure/retry signals, payment/fiscal reconciliation backlog, secret/vault access failures, authentication abuse/rate-limit signals and failed background jobs/dead-letter conditions where applicable.

Required evidence before Gate M PASS:

- real runtime scraping/collection;
- alert destination;
- alert owner/on-call;
- test alert delivered and acknowledged;
- rollback drill;
- provider outage drill;
- incident tabletop or controlled exercise.

CI/build success is not production operational evidence.
