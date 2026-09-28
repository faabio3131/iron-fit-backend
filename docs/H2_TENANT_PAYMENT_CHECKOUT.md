# IRON — Macro H2 — Tenant Payment Hosted Checkout

Status: **CANDIDATE — internal tenant-scoped checkout core implemented. Physical academy gateway homologation remains BLOCKED_EXTERNAL.**

## Authority

Academy -> student payment is intentionally separate from FM -> academy SaaS billing.

The academy-owned checkout resolves exactly one ACTIVE TENANT `IntegrationConnection` for:

- the authenticated/canonical `gymId`;
- the active runtime environment;
- capability `billing.student.checkout`;
- a non-revoked, non-expired Vault-backed credential.

The request never selects a tenant, merchant account or provider from free-form body input.

## Provider boundary

The provider adapter receives only:

- immutable request id;
- canonical charge id/student id;
- amount and BRL currency for the V1 launch;
- due date;
- non-secret `publicConfiguration`;
- a redacted `IntegrationSecretValue` resolved from the tenant Vault boundary.

No provider secret is stored on `Charge`, returned by the API or written to audit.

No real provider adapter is invented before a provider is selected from an official contract.

## Hosted checkout / tokenization boundary

The IRON H2 API does not accept:

- PAN/card number;
- CVV/CVC;
- expiration date;
- raw cardholder secret material;
- provider secret/API key.

The adapter must use provider-hosted checkout, hosted fields, PIX or a provider tokenization primitive appropriate to the provider contract.

The canonical `Charge` persists only bounded non-secret result metadata:

- provider code;
- canonical IntegrationConnection id;
- request id;
- provider charge reference;
- hosted checkout URL;
- PIX payload when applicable;
- checkout expiration.

## Idempotency and tenant isolation

`gatewayRequestId` is unique. Replaying the same request id for the same charge returns the existing provider reference; a different request id for an already-bound charge fails closed.

The server derives `gymId` from authenticated tenant context. `CreateChargePaymentSessionDto` contains only `requestId`.

Tenant A can never resolve a TENANT connection or secret belonging to Tenant B because the Integration Secret Resolver receives the canonical scope `{ scope: 'TENANT', gymId }`.

## Physical Gate H2 — BLOCKED_EXTERNAL

H2 cannot be declared physically homologated until there is evidence for:

1. academy payment provider(s) allowed by the Launch Matrix;
2. provider-specific adapter from official documentation;
3. OWNER-configurable TENANT IntegrationConnection;
4. real credential in the real Vault;
5. real HOMOLOG hosted checkout/PIX transaction;
6. provider webhook verification and canonical tenant resolution;
7. replay/idempotency tests against real provider behavior;
8. cross-tenant adversarial certification;
9. confirmation that raw PAN/CVV never traverses or persists in IRON;
10. refund/reconciliation behavior where applicable.

Internal CI certifies only architecture, tenant isolation and fail-closed behavior.
