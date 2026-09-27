# IRON — C6/C7/C8 Integration Administration Hardening

Status: **CANDIDATE — aguardando CI/PR/merge/post-merge**

Baseline:
- C6A/C7/C8 backend/API already merged at `cc11573a4a2284a903024598f3ec0fdb186de577`;
- safe provider catalog already merged at `23459c608a22e470a08f81ff19289c32fb6ac609`.

This increment intentionally avoids duplicating those implementations and closes remaining hardening gaps.

## Commercial entitlement authority

A tenant-facing provider may exist in code without being available to every academy.

Each tenant-facing provider declares `tenantEntitlementFeatureKey`, which maps it to the configurable product capability catalog.

Before create, replace, rotate or test, tenant administration resolves the effective entitlement:

`Platform policy -> Plan entitlement -> Tenant configuration`

The operation fails closed unless the effective value is FEATURE=true.

Revoke remains available even after downgrade so an academy can always disable/clean up an existing credential.

## Environment authority

Create DTOs no longer accept DEV/HOMOLOG/PROD as client authority.

The active runtime provides the environment through `IRON_RUNTIME_ENV`.

The provider must support that active environment.

## Provider credential test

A physical Vault read is not considered provider verification.

`IntegrationCredentialProbeRegistry` requires a provider-specific verifier.

Only a successful provider probe updates `lastVerifiedAt`.

No probe -> fail closed.

## Replace / rotation

Replace and rotate are explicit write-only operations.

The hardened flow creates a **new opaque secretReference**, writes the new physical secret first, then conditionally swaps the canonical PostgreSQL pointer if the previous reference/version are still unchanged.

The previous physical secret is scheduled for revoke only after the DB swap.

This avoids promoting a partially rotated in-place secret when the canonical DB update fails.

## Durable cleanup queue

External cleanup can fail after a safe canonical transition.

`IntegrationSecretCleanupTask` stores only:
- opaque secret reference;
- connection id when available;
- governed reason;
- status/timestamps/attempt count.

It never stores a reusable secret value.

Audit events use the cleanup task ID and reason, never the secretReference as an AuditLog identifier.

## Remaining outside this increment

- premium Web/app UX;
- real provider probes;
- physical OCI tenancy/IAM homologation;
- C11 physical DR/restore evidence;
- C14 governed break-glass;
- external provider homologation.
