# IRON — Macro I2/I3/I4 — OAuth Provider Token Lifecycle

Status: **ENGINEERING CANDIDATE — external credentials/homologation still pending**

## Authority model

OAuth keeps the FM mixed authority model:

- OAuth App official: `IntegrationConnection GLOBAL`;
- client ID/endpoints/scopes/redirect allowlist: safe `publicConfiguration`;
- client secret: GLOBAL Vault secret;
- customer authorization: `IntegrationConnection TENANT`;
- tenant access/refresh token bundle: TENANT Vault secret;
- PostgreSQL: token metadata only.

No token or client secret is persisted in PostgreSQL.

## I2 — Meta Adapter

Meta remains one provider `meta`.

Technical capabilities remain:

- Facebook;
- Instagram;
- WhatsApp.

The token adapter is configuration-driven and uses the OAuth App GLOBAL configuration; a new tenant never requires code/deploy/env.

Physical Meta endpoints/scopes/app approval remain external homologation evidence.

## I3 — Google Adapter

Google uses the same provider-neutral token contract.

For offline server-side access, the GLOBAL App configuration must request the Google parameters/scopes approved for the actual capability. The code does not hardcode tenant credentials or scopes.

Physical Google OAuth Client, consent configuration and required API scopes remain external homologation evidence.

## GLOBAL OAuth publicConfiguration

Additional fields consumed after I1:

- `tokenEndpoint` HTTPS;
- optional `revocationEndpoint` HTTPS;
- `clientAuthMode=BODY|BASIC`;
- `refreshMode=REFRESH_TOKEN|REAUTHORIZE`;
- optional non-secret `tokenRequestParams`.

Reserved OAuth parameters cannot be overridden through `tokenRequestParams`.

## Token bundle

Vault secret schema contains:

- access token;
- refresh token when available;
- token type;
- granted scopes;
- access-token expiry.

PostgreSQL `IntegrationOAuthTokenState` contains only:

- tenant connection;
- GLOBAL app connection ID;
- provider/environment;
- token type;
- granted scopes;
- access-token expiry;
- whether refresh exists;
- refresh generation;
- refresh lease metadata;
- reauthorization status;
- sanitized error code.

## I4 — Refresh Coordinator

Refresh uses:

1. current ACTIVE tenant connection;
2. token metadata;
3. token bundle from Vault;
4. GLOBAL OAuth App binding;
5. persistent 30-second refresh lease;
6. provider adapter;
7. Vault `expectedVersion` compare-and-set;
8. atomic metadata generation increment.

A concurrent worker cannot last-write-wins over a rotated token.

If refresh is unavailable or the provider is configured as `REAUTHORIZE`, the connection becomes `DEGRADED` and receives `reauthRequiredAt`.

## Callback completion

The public callback never receives tenant/gym authority.

It consumes the state-bound context from I1/I5, resolves the GLOBAL client secret server-side, exchanges the code through the registered provider adapter, stores tenant tokens in Vault, updates connection metadata and revokes the ephemeral PKCE secret.

## External boundary

This engineering does not claim Meta/Google homologation.

Real PASS still requires:

- official App/OAuth client;
- redirect URIs registered at provider;
- exact production scopes reviewed;
- credentials in real Vault;
- connect/reconnect/revoke tests;
- real token exchange/refresh/revocation evidence.
