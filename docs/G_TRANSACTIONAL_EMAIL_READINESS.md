# IRON — Macro G — Transactional E-mail Commercial Readiness

Status: **CANDIDATE — internal delivery core implemented. Physical provider/domain homologation remains BLOCKED_EXTERNAL.**

## Scope

Macro G covers the launch-critical transactional e-mail flows required by the Commercial Readiness schedule:

- password reset;
- e-mail verification;
- e-mail change;
- provider delivery lifecycle;
- sender-domain readiness;
- SPF/DKIM/DMARC;
- retry/failure handling.

The implementation reuses the canonical IntegrationConnection + Integration Secret Vault authority. It does not introduce provider secrets in environment variables, PostgreSQL, logs or API responses.

## Internal delivery authority

Pending `AuthActionToken` records are the canonical queue for security e-mails.

The delivery worker:

- processes only unconsumed, unexpired `PENDING` actions;
- uses a durable lease so concurrent replicas cannot send the same action simultaneously;
- uses bounded retry/backoff;
- resolves exactly one active GLOBAL `IntegrationConnection` with capability `email.transactional`;
- fails closed when zero or multiple connections are eligible;
- resolves the physical provider credential only at the external boundary through `IntegrationSecretResolverService`;
- decrypts the action token only in memory immediately before composing the e-mail;
- never writes the raw action token or provider credential to AuditLog or delivery metadata;
- clears `deliveryCiphertext` after successful or terminal delivery to minimize recoverable-secret retention;
- persists only sanitized provider metadata: provider code, canonical connection id, optional provider message reference and bounded error code.

Dispatch is disabled by default through `TRANSACTIONAL_EMAIL_DISPATCH_ENABLED=false`. Enabling it without a certified provider connection still fails closed.

## Templates

The internal templates cover:

- `PASSWORD_RESET`;
- `EMAIL_VERIFICATION`;
- `EMAIL_CHANGE`.

The action link is derived from the governed `WEB_APP_URL` and requires HTTPS. The token is included only in the outbound action URL and remains absent from persistence/audit after delivery.

Provider-specific HTML branding can be refined later without changing token authority or delivery security.

## Retry and failure lifecycle

Delivery metadata is durable:

- attempt count;
- next attempt time;
- last attempt time;
- lease owner/expiry;
- provider code;
- connection id;
- provider message reference;
- sanitized error code;
- terminal `DELIVERED` or `FAILED` state.

Retries use bounded backoff and stop after the maximum attempt count. Expired actions are terminally failed and their encrypted delivery material is removed.

Provider-specific bounce/complaint webhooks are **not** fabricated before a provider is selected. They remain part of the physical homologation evidence.

## External dependencies — BLOCKED_EXTERNAL

The following evidence is still required before **Gate G** can be declared PASS:

1. real transactional e-mail provider selected and approved for IRON;
2. real provider adapter implemented for that provider;
3. provider credential stored as GLOBAL IntegrationConnection secret in the real Vault;
4. official sender domain defined;
5. SPF record published and validated;
6. DKIM keys published and validated;
7. DMARC policy published and validated;
8. provider account/sender identity approved;
9. real HOMOLOG delivery for signup/verification, password reset and e-mail change;
10. controlled failure/retry evidence;
11. bounce/complaint handling evidence according to the chosen provider;
12. proof that no credential/action token leaks to logs, traces or API responses.

Until those items exist, Macro G remains **BLOCKED_EXTERNAL for physical homologation** even if internal CI is green.

## Gate boundary

Internal engineering may be certified and merged independently.

Do not claim provider/domain homologation from CI/build alone. Gate G requires real provider + DNS + delivery evidence.
