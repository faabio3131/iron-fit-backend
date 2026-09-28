# IRON — Macro J4 — Fiscal Cancellation & Reconciliation

Status: **CANDIDATE — internal J4 lifecycle implemented. Real NFS-e provider/municipality evidence remains BLOCKED_EXTERNAL.**

## Reconciliation of unknown issuance outcome

J2/J3 deliberately move an issuance with uncertain transport outcome to `RECONCILIATION_PENDING` instead of blindly repeating `POST /v1/issuances`.

J4 consumes the certified FM Fiscal Bridge reconciliation contract:

`POST /v1/reconciliations`

The request is built from the same immutable paid Charge/FinancialTransaction facts already persisted in the durable FiscalHandoff.

Controls:

- deterministic idempotency key `<handoff-idempotency>:reconcile`;
- canonical `iron_charge` operation reference must match the handoff;
- provider-selected document id must not conflict with a previously known document id;
- `pending` schedules a later reconciliation;
- `divergent`, reference mismatch or missing selected document fail closed;
- `matched` transitions to `RECONCILED` and records only provider-neutral reconciliation metadata;
- retries are permitted for reconciliation itself because they are deterministic and idempotent.

## Cancellation

Cancellation is an explicit OWNER/SUPER_ADMIN action with step-up authentication.

IRON never accepts access key, authorization protocol, tenant, unit or provider from the cancellation request body. They are resolved from the canonical FiscalHandoff and the current governed FM Fiscal Bridge connection.

The only business input supplied by the user is a bounded cancellation justification required by the public contract.

The bridge call is:

`POST /v1/cancellations`

using deterministic idempotency key:

`<handoff-idempotency>:cancel`

A handoff is cancelable only when the canonical document is in an authorized/reconciled state and has the access key plus authorization protocol required by the contract.

## Unknown cancellation outcome

Cancellation does not become `CANCELLED` merely because a request was sent.

Accepted, pending, timeout or unknown outcomes stay `CANCELLATION_PENDING`.

The maintenance loop first queries:

`POST /v1/queries`

with the canonical access key.

- `cancelled` -> transition to `CANCELLED`;
- `pending` -> query again later;
- `authorized` -> cancellation may be safely retried with the same idempotency key and original bounded justification;
- `not_found` -> fail closed;
- provider rejection returns the handoff to its authorized state and records bounded rejection metadata.

This avoids declaring cancellation before the authoritative fiscal service confirms it.

## Data boundary

J4 persists only non-secret lifecycle metadata:

- reconciliation fingerprint;
- reconciliation issue codes;
- cancellation request/protocol references;
- bounded cancellation justification;
- bounded rejection code/message;
- final timestamps/status.

No workload bearer secret, certificate, municipal credential, private key or provider password is persisted in the fiscal handoff.

## BLOCKED_EXTERNAL

CI does not certify a real fiscal cancellation or reconciliation.

Gate J still requires external evidence for:

1. live FM Fiscal Bridge deployment in the intended environment;
2. real workload identity/credential in Vault;
3. real fiscal account/unit binding;
4. official municipality/provider configuration;
5. real NFS-e issuance;
6. controlled unknown-outcome reconciliation;
7. real cancellation and subsequent query confirmation;
8. provider/municipality reconciliation evidence;
9. production approval where applicable.
