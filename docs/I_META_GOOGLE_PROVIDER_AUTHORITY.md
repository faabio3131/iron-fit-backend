# IRON — Macro I — Meta/Google Provider Authority

Status: **CERTIFIED_INTERNAL CANDIDATE — OAuth physical flow pending**

## Decisão V1

- `channel.meta` = LAUNCH;
- `channel.google` = LAUNCH;
- Meta é um único provider guarda-chuva;
- Facebook, Instagram e WhatsApp são capabilities técnicas do provider Meta, não autoridades comerciais separadas.

## Autoridade de entitlement

Capabilities persistidas:

- `integration.meta`;
- `integration.google`.

Ambas são FEATURE e pertencem ao domínio `INTEGRATION`.

Os planos `IRON_V1_TRIAL` e `IRON_V1` concedem essas capabilities. A Launch Matrix liga:

- `channel.meta` -> `integration.meta`;
- `channel.google` -> `integration.google`.

Com isso, o fluxo de credenciais tenant continua usando a autoridade já certificada:

`Platform policy -> Plan entitlement -> Tenant configuration -> IntegrationConnection + Vault`.

## Provider registry

### Meta

Provider code: `meta`

Capabilities técnicas:

- `meta.facebook`;
- `meta.instagram`;
- `meta.whatsapp`.

Auth: `OAUTH2`.

Suporta OAuth e webhook.

### Google

Provider code: `google`

Capability técnica inicial:

- `google.oauth`.

Auth: `OAUTH2`.

Suporta OAuth.

## Configurabilidade

Nenhum tenant exige alteração de código, branch, deploy ou variável exclusiva.

Não existem no bootstrap:

- app ID de cliente;
- client secret;
- access token;
- refresh token;
- account ID hardcoded.

Credenciais e tokens reais continuam pertencendo ao Integration Secret Vault, com separação GLOBAL/TENANT e DEV/HOMOLOG/PROD.

## Limite desta entrega

Esta entrega cria a autoridade executável de provider/entitlement.

Ainda não declara concluídos:

- I1 Authorization Code/PKCE/state;
- I2 token exchange Meta real;
- I3 token exchange/refresh/revoke Google real;
- I4 refresh coordinator;
- I5 callback tenant binding;
- I6 communication dispatch;
- homologação externa de Meta/Google.

Esses itens continuam fail-closed até seus WPs correspondentes.
