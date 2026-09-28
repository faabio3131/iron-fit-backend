# IRON — Macro J1 — Durable Fiscal Handoff

Status: **CANDIDATE — internal fiscal handoff persistence implemented. Provider/municipality homologation remains BLOCKED_EXTERNAL.**

## Purpose

J1 turns the previously audit-only fiscal handoff into a durable, idempotent provider-neutral record created atomically from the authoritative paid Charge + FinancialTransaction fact.

IRON remains responsible only for the commercial settlement fact. FM Fiscal Core remains responsible for:

- fiscal tenant/unit binding;
- jurisdiction support;
- readiness;
- tax rules;
- numbering/signing;
- provider selection;
- municipal/state adapters;
- issuance/cancellation/reconciliation policy.

## Canonical handoff

Every paid IRON charge materializes exactly one FiscalHandoff with:

- canonical gymId;
- canonical chargeId;
- canonical financial transactionId;
- deterministic idempotencyKey;
- FM Fiscal API contract version;
- host namespace fm.iron;
- product pack iron;
- use case;
- operation kind;
- document kind nfse;
- amount/currency;
- payment method;
- settledAt;
- state PENDING_CAPABILITY.

The record intentionally does not contain:

- municipal/provider credentials;
- certificates/private keys;
- access tokens;
- readiness assertions;
- municipality inference;
- tax calculation;
- provider-specific payload.

## Atomicity

The FiscalHandoff is created inside the same SERIALIZABLE transaction that records the authoritative payment.

A replay of the same paid charge:

- returns the existing handoff;
- does not create a duplicate;
- compares immutable fiscal facts;
- fails closed if the persisted handoff diverges from the canonical paid fact.

This preserves deterministic recovery after process failure or client retry.

## Lifecycle prepared for J2-J4

The durable model defines provider-neutral lifecycle states for:

- PENDING_CAPABILITY;
- READY_TO_ISSUE;
- SUBMITTED;
- AUTHORIZED;
- REJECTED;
- RECONCILIATION_PENDING;
- RECONCILED;
- CANCELLATION_PENDING;
- CANCELLED;
- FAILED.

Provider request/document/access-key/protocol references are optional metadata only and do not grant readiness.

## Gate boundary

This PR certifies J1 internal persistence and idempotency only.

It does not claim:

- a real fiscal provider;
- a real municipality;
- a real certificate/credential;
- HOMOLOGATION_READY;
- PRODUCTION_APPROVED;
- real NFS-e issuance/cancellation.

J2-J4 must consume the public FM Fiscal Bridge contract and real Vault-backed S2S credentials without duplicating fiscal rules inside IRON.
