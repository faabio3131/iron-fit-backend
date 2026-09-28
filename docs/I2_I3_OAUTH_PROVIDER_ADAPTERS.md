# IRON — Macro I2/I3 — Meta + Google OAuth Provider Adapters

Status: **CANDIDATE — engenharia interna implementada; aguardando CI/PR/merge. Homologacao fisica de Meta/Google continua bloqueada ate o C Gate e credenciais/apps reais.**

## Autoridade arquitetural

I2/I3 reutilizam exclusivamente:

- `IntegrationProviderRegistry`;
- `IntegrationConnection`;
- `IntegrationOAuthCoreService` / I1+I5;
- Integration Secret Vault;
- Product entitlements e tenant canonical;
- AuditLog sanitizado.

Nao existe cofre, tabela de token, tenant selector ou configuracao por `.env` especifica de cliente.

## Modelo GLOBAL + TENANT

O OAuth App da FM permanece em `IntegrationConnection GLOBAL`.

Configuracao publica esperada do App:

- `clientId`;
- `authorizationEndpoint`;
- `exchangeEndpoint`;
- `redirectUris[]`;
- `capabilityScopes`;
- `pkceMode`;
- `authorizationParams`;
- `revocationEndpoint` quando o provider suportar revogacao programatica.

O `client_secret` do App GLOBAL permanece exclusivamente no Vault.

Depois do callback, access/refresh credentials da academia ficam em um novo secret reference TENANT. PostgreSQL guarda apenas:

- referencia e versao opacas;
- binding para o `oauthAppConnectionId` GLOBAL usado na autorizacao;
- scopes concedidos;
- expiracao do access credential;
- indicador `oauthRefreshCapable`.

Nenhum access token, refresh token, authorization code, PKCE verifier ou client secret e persistido no banco, AuditLog ou resposta da API.

## I2 — Meta Adapter

O adapter Meta:

- troca o authorization code no `exchangeEndpoint` governado;
- usa `client_id`, client secret GLOBAL, redirect URI canonico e PKCE quando configurado;
- normaliza access credential, expiracao e scopes;
- grava o credential bundle somente no Vault TENANT;
- permite reautorizacao sobre a mesma `IntegrationConnection` sem alteracao de codigo/deploy;
- invalida localmente a referencia anterior depois que a nova credencial fica canonica.

Provider-side disconnect/revoke especifico da Meta permanece para I8 quando houver mecanismo oficial aplicavel ao capability utilizado.

## I3 — Google Adapter

O adapter Google:

- exige `authorizationParams.access_type=offline` para fluxo refresh-capable;
- troca authorization code via POST form;
- suporta access + refresh credentials;
- implementa a primitiva de refresh do provider;
- implementa a primitiva de revogacao usando `revocationEndpoint`;
- preserva o refresh credential quando uma resposta de refresh retorna somente novo access credential;
- valida que scopes retornados pelo provider nao sejam inferiores aos scopes governados solicitados.

A coordenacao concorrente de refresh, lock, retry e idempotencia e responsabilidade do I4 e nao e declarada concluida por este WP.

## Callback e tenant binding

O callback publico recebe somente:

- `providerCode` na rota;
- `state`;
- `code`.

Nao aceita `gymId` ou `tenantId`.

I5 resolve o tenant e a sessao canonicos pelo state single-use. I2/I3 somente prosseguem se:

- tenant connection continuar no mesmo provider/ambiente;
- OAuth App GLOBAL continuar ACTIVE;
- versao fisica do client secret coincidir com a versao canonica;
- conexao tenant nao estiver SUSPENDED/DISCONNECTED.

## Rollback e limpeza

Se a escrita no Vault ou a promocao canonica falhar:

- a nova referencia de secret e revogada ou registrada para cleanup;
- quando o adapter suporta revogacao provider-side, o credential recem-emitido recebe best-effort revoke;
- PKCE secret reference consumida e revogada apos o callback;
- falha de limpeza vira `IntegrationSecretCleanupTask` PENDING, sem reexpor segredo.

## Limite do gate

Este trabalho certifica apenas engenharia interna.

Nao declarar I2/I3 fisicamente homologados ate existirem:

- C Gate real do Vault;
- Meta App real/aprovado + redirect URIs + credenciais no Vault;
- Google OAuth App real + consent/redirect URIs + credenciais no Vault;
- fluxo real em HOMOLOG com evidencias reproduziveis.

I4, I6, I7 e I8 continuam no cronograma.
