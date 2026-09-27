# IRON — Commercial Readiness — Secret Vault Controls

Status: **CANDIDATE — aguardando CI/PR/merge/post-merge**

Baseline: C1-C3 certified on main at `bb6fb4944089e3e1522669c2b101c1435542db80`.

## State of C4

C4 — Vault Backend físico — is **BLOCKED_EXTERNAL** until a real managed secret backend is selected, provisioned and governed. No database column, .env-per-client, home-grown encryption or fake adapter may be promoted as a physical Vault.

The code therefore keeps an explicit unavailable adapter by default.

## Controls in this increment

### C5 boundary and fail-closed resolver

`IntegrationSecretValue` does not reveal its content through string conversion, JSON serialization or Node inspection. Cleartext is accessible only through explicit `reveal()`, intended for the final external provider adapter boundary.

The resolver validates, before Vault access:

- canonical connection id;
- GLOBAL/TENANT scope;
- tenant id when TENANT;
- exact runtime environment;
- ACTIVE status;
- secret reference and version;
- non-revoked/non-expired lifecycle state.

Cross-tenant denial occurs before a Vault read.

### C8 lifecycle metadata

PostgreSQL stores only non-secret lifecycle metadata: version, rotation, expiry, last-use and revocation timestamps. Database constraints prevent impossible partial states.

### C9 structural redaction

Audit redaction is normalized across camelCase/snake_case/hyphenated key names and covers password, tokens, secrets, API keys, private keys, authorization, card PAN/CVV/CVC and secretReference recursively.

### C10 environment isolation

`IRON_RUNTIME_ENV` is mandatory and must be DEV, HOMOLOG or PROD. Secret resolution filters by the exact active environment; production credentials cannot be selected by a DEV/HOMOLOG runtime.

### C12 adversarial isolation

Permanent tests prove that forged tenant scope is rejected before physical secret resolution.

### C13 repository secret scanning

The quality gate scans tracked files before build for high-confidence private keys and common live credential formats, and rejects tracked non-example .env files.

## Not certified by this increment

- physical C4 backend;
- write/rotate/revoke admin API (C6);
- step-up wiring to integration changes (C7);
- real secret write/rotation (remaining C8);
- physical Vault backup/recovery policy (C11);
- break-glass execution flow (C14);
- any real provider.
