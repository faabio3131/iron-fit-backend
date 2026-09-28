# IRON — Macro I1/I5 — OAuth Core + Tenant Binding

Status: **CANDIDATE — aguardando CI/PR/merge/post-merge**

## Autoridade única

OAuth reutiliza a infraestrutura existente de:

- `IntegrationProviderRegistry`;
- `IntegrationConnection`;
- Product entitlement tenant;
- Integration Secret Vault;
- sessão JWT autenticada.

Não existe banco, cofre ou identidade paralela por provider.

## I1 — OAuth Core

O início do fluxo:

- exige OWNER autenticado;
- exige step-up;
- deriva tenant de `activeGymId`;
- deriva sessão de `sessionId` validado pelo JWT;
- resolve provider no registry;
- resolve entitlement efetivo do tenant;
- resolve OAuth App oficial por `IntegrationConnection GLOBAL` do mesmo provider/ambiente;
- usa apenas redirect URI pertencente à allowlist do App global;
- deriva scopes das capabilities selecionadas por configuração GLOBAL;
- não aceita scope arbitrário vindo do tenant;
- cria state aleatório de alta entropia;
- armazena somente SHA-256 do state;
- usa PKCE S256 quando o App global está configurado com `pkceMode=S256`;
- PKCE verifier fica no Vault; PostgreSQL guarda somente referência opaca + versão.

Configuração pública GLOBAL esperada:

- `clientId`;
- `authorizationEndpoint` HTTPS;
- `redirectUris[]` HTTPS;
- `capabilityScopes`;
- `pkceMode=S256|NONE`;
- `authorizationParams` não secretos e sem sobrescrever parâmetros reservados.

O `client_secret` nunca pertence à configuração pública; ele permanece no segredo da conexão GLOBAL.

## I5 — Callback Tenant Binding

`IntegrationOAuthAuthorizationAttempt` vincula:

- tenant `connectionId`;
- OAuth App global `appConnectionId`;
- provider;
- environment;
- `userId`;
- `sessionId`;
- `stateHash`;
- redirect URI;
- capabilities/scopes governados;
- PKCE secret reference/version;
- expiração;
- consumo single-use.

O callback interno somente pode reivindicar o contexto quando:

- state existe e não expirou;
- state ainda não foi consumido;
- provider/ambiente são os mesmos;
- refresh session original continua válida;
- usuário original continua OWNER do mesmo tenant;
- conexão tenant continua válida;
- OAuth App global continua ACTIVE e com credencial válida.

O consumo do state é atômico por `updateMany(... consumedAt: null ...)`.

Nenhum `gymId`/tenantId fornecido pelo provider ou cliente seleciona o destino.

## Segurança

Nunca persistidos no PostgreSQL:

- raw OAuth state;
- PKCE verifier;
- authorization code;
- client secret;
- access token;
- refresh token.

Authorization code e PKCE verifier são representados internamente por `IntegrationSecretValue`, que redige string/JSON/inspect.

## Limite deste WP

I1/I5 não executam token exchange externo.

I2 Meta e I3 Google consumirão o contexto reivindicado por `claimCallback()`, resolverão o segredo GLOBAL do App, trocarão o code no provider e gravarão o token tenant no Vault.

Até isso existir e ser homologado fisicamente, callback/provider externo permanece incompleto e nenhum claim de homologação é permitido.
