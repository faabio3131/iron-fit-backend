# IRON — Macro H — Billing Connection, Card Boundary & Webhook Security

Status: **CANDIDATE — H1/H4 internal connection authority implemented. Physical gateways and controlled real transactions remain BLOCKED_EXTERNAL.**

## Domain separation

Macro H preserves two independent financial domains:

1. **FM -> academy** — IRON SaaS subscription billing;
2. **academy -> student** — the academy's own financial operation.

This work package advances the FM -> academy side without reusing tenant merchant credentials and without changing the existing student financial domain.

## H1 — FM billing provider authority

Real FM billing no longer needs a secret embedded in an environment variable or a provider-specific branch inside the billing service.

The canonical production-shaped authority is:

- one ACTIVE GLOBAL `IntegrationConnection`;
- runtime environment must match DEV/HOMOLOG/PROD;
- capability `billing.saas.fm`;
- secretReference/version resolved only through Integration Secret Vault;
- provider adapter selected through `SaasBillingProviderRegistry`;
- optional `SAAS_BILLING_PROVIDER` acts only as a non-secret provider-code pin;
- zero or multiple eligible GLOBAL connections fail closed.

`INTERNAL_SANDBOX` remains available only for deterministic non-production certification and remains forbidden in PROD.

Provider operations receive a bounded `SaasBillingProviderContext` containing:

- canonical connection id;
- non-secret `publicConfiguration`;
- redacted `IntegrationSecretValue` credential.

Checkout, refund and webhook verification all use that same canonical context.

## H3 — Card Data / Tokenization Boundary

The IRON SaaS billing domain does not require raw card fields.

The contract remains:

- no CVV/CVC persistence;
- no full PAN/card number persistence;
- checkout should use hosted checkout/hosted fields/provider tokenization when a real gateway is selected;
- frontend never receives the provider secret;
- IRON persists provider references and minimum non-sensitive metadata only.

The final PCI/compliance scope depends on the provider and checkout architecture actually selected and must not be inferred from tokenization alone.

## H4 — Webhook Security Gateway

The existing billing webhook route may carry a provider code only as a routing hint. The service resolves the canonical GLOBAL billing connection and rejects a path provider that differs from that connection.

For a real provider adapter:

- signature/certificate verification receives the Vault-backed credential/context;
- tenant is never selected from webhook payload;
- eventId + payloadHash remain the replay/idempotency authority;
- only normalized provider events reach billing state transitions;
- provider raw secrets remain outside PostgreSQL, AuditLog and API responses.

Provider-specific timestamp tolerance, rotating signing secrets or certificate chains are adapter responsibilities and must be certified from the official provider contract.

## H2 — Academy -> student

The academy-owned gateway remains a separate tenant-scoped capability and must not be silently merged into FM SaaS billing.

Its physical completion still requires:

- provider(s) allowed by the Launch Matrix;
- OWNER-configurable TENANT IntegrationConnection;
- tenant credential in Vault;
- canonical server-side tenant resolution;
- hosted checkout/tokenization boundary;
- adversarial cross-tenant tests;
- real HOMOLOG transaction/webhook evidence.

## External dependencies — BLOCKED_EXTERNAL

Gate H cannot PASS until there is evidence for:

1. real FM gateway account/provider selected;
2. provider-specific adapter implemented against the official contract;
3. GLOBAL credential stored in the real Vault;
4. real HOMOLOG checkout and payment;
5. recurring charge/dunning/reactivation;
6. secure webhook verification and replay test;
7. controlled refund/reconciliation;
8. academy gateway path if it remains LAUNCH;
9. proof that no raw CVV/PAN persists;
10. controlled transactions proving tenant/card/webhook isolation.

Internal CI certifies architecture and fail-closed behavior only; it does not constitute payment-provider homologation.
