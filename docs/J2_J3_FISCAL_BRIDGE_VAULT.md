# IRON — Macro J2/J3 — FM Fiscal Bridge + Vault

Status: **CANDIDATE — internal Bridge/Vault integration implemented. Real fiscal provider/municipality homologation remains BLOCKED_EXTERNAL.**

## J2 — Provider-neutral FM Fiscal Bridge

IRON consumes the certified public FM Fiscal Bridge contract instead of embedding municipality/provider rules in the SaaS.

The bridge connection is represented by exactly one ACTIVE GLOBAL `IntegrationConnection` in the active runtime with:

- providerCode `fm-fiscal-core`;
- capability `fiscal.bridge`;
- auth model `ACCESS_TOKEN`;
- HOMOLOG or PROD environment;
- non-secret `publicConfiguration` with HTTPS `baseUrl` and `workloadId`;
- workload bearer secret stored only in Integration Secret Vault.

IRON does not store municipal certificates, CSC, provider passwords, municipal tokens or private keys.

## Fiscal scope binding

The FM Fiscal public contract requires explicit host/tenant/unit/environment scope.

IRON therefore persists an explicit `FiscalScopeBinding` per gym + environment containing only:

- canonical IRON gym id;
- external FM Fiscal tenant id;
- external FM Fiscal unit id;
- active flag;
- audit metadata.

The binding is OWNER/SUPER_ADMIN governed and requires step-up authentication. No tenant/unit id is accepted from the fiscal dispatch payload or from provider responses.

This avoids guessing that a gym id and fiscal unit id are equivalent.

## Capability gate

Before every issuance attempt, IRON calls:

`POST /v1/capabilities/query`

with document kind `nfse`.

Issuance proceeds only when:

- capability includes `nfse`;
- capability includes `issue`;
- HOMOLOG runtime receives `HOMOLOGATION_READY` or `PRODUCTION_APPROVED`;
- PROD runtime receives `PRODUCTION_APPROVED`.

`CONTRACT_ONLY` remains fail-closed and schedules a later capability check.

## Issuance

After readiness passes, IRON sends the already-authoritative paid charge through:

`POST /v1/issuances`

using:

- contract version `1.0.0`;
- host namespace `fm.iron`;
- canonical external tenant/unit binding;
- deterministic `Idempotency-Key` from the durable FiscalHandoff;
- operation kind `membership` or `recurring_charge`;
- NFS-e document family;
- amount/payment/settlement facts from the paid charge.

IRON does not calculate tax, choose municipality/provider, sign documents, allocate fiscal numbering or infer jurisdiction.

## J3 — S2S workload credential via Vault

The outbound request includes the public FM Fiscal workload credential id and the opaque bearer secret.

Only the workload id is stored in `publicConfiguration`.

The bearer secret is resolved at the external boundary through `IntegrationSecretResolverService` and `IntegrationSecretVaultPort`.

It is never persisted in:

- FiscalHandoff;
- FiscalScopeBinding;
- AuditLog;
- API response;
- runtime configuration files committed to Git.

## Unknown outcome

If capability lookup fails, the operation remains `PENDING_CAPABILITY` and is retried later.

If an issuance request has started and its outcome becomes uncertain because of timeout, transport failure or malformed response, the handoff transitions to `RECONCILIATION_PENDING`.

IRON does **not** blindly retry an uncertain fiscal issuance.

J4 owns reconciliation/cancellation handling.

## Runtime activation

`FISCAL_BRIDGE_DISPATCH_ENABLED=false` by default.

It may only be enabled after:

1. a real GLOBAL `fm-fiscal-core` connection exists;
2. its workload credential is in the real Vault;
3. the relevant gym has a valid FiscalScopeBinding;
4. the FM Fiscal endpoint is reachable in the intended environment;
5. capability/readiness evidence is real.

## BLOCKED_EXTERNAL

The following remain external/physical requirements and are not claimed by CI:

- real FM Fiscal Bridge URL/deployment;
- real workload identity/credential;
- real FiscalAccountBinding inside FM Fiscal Core;
- municipality/provider selection;
- provider/municipal certificate or credential;
- official NFS-e homologation environment;
- real issuance, cancellation and reconciliation evidence;
- production approval.

Internal CI certifies contract alignment, tenant/unit binding, Vault secret boundary, capability gate, idempotency and unknown-outcome behavior only.
