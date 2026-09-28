# IRON — Macro I4/I8 — OAuth Refresh Coordinator + Disconnect/Revoke

Status: **CANDIDATE — engenharia interna implementada; aguardando CI/PR/merge. Homologacao fisica continua dependente de C Gate e providers reais.**

## I4 — Token Refresh Coordinator

O coordenador de refresh:

- executa ciclo periodico sem depender de cron externo;
- seleciona apenas conexoes TENANT OAuth refresh-capable;
- renova antes da expiracao do access credential;
- usa lease persistente no PostgreSQL para impedir refresh concorrente entre replicas;
- usa `oauthRefreshLeaseOwner` + `oauthRefreshLeaseUntil` como autoridade de lock;
- promove o novo credential bundle somente por CAS com secretReference/secretVersion anteriores;
- grava novo secret reference no Vault e revoga a referencia anterior;
- limpa lease, retry e failure counter em refresh bem-sucedido;
- em falha, marca DEGRADED, libera lease e agenda retry com backoff governado;
- nao grava access/refresh token no banco, AuditLog ou respostas.

Metadados persistidos, nao secretos:

- `oauthAccessExpiresAt`;
- `oauthRefreshLeaseOwner`;
- `oauthRefreshLeaseUntil`;
- `oauthRefreshRetryAt`;
- `oauthRefreshFailureCount`;
- `oauthLastRefreshAt`;
- scopes concedidos e binding do OAuth App GLOBAL.

O refresh Google usa a primitiva provider-specific do I3. Providers sem refresh nao entram no coordenador.

## I8 — Disconnect/Revoke

A rota canonica existente de revoke da conexao TENANT detecta `authModel=OAUTH2` e delega ao lifecycle OAuth.

A ordem e fail-closed:

1. step-up do OWNER continua obrigatorio pela autoridade de credenciais;
2. PostgreSQL marca a conexao `DISCONNECTED` e `secretRevokedAt` atomicamente;
3. qualquer refresh lease e cancelado;
4. o sistema deixa de resolver/usar a credencial imediatamente;
5. quando o provider suporta revogacao programatica, a revogacao externa e tentada;
6. somente depois o secret fisico e destruido no Vault.

Se provider ou Vault estiver indisponivel:

- a desconexao logica permanece efetiva;
- a referencia fisica fica inacessivel ao runtime normal;
- `IntegrationSecretCleanupTask` registra retry duravel;
- `OAUTH_PROVIDER_REVOKE_PENDING` preserva o secret apenas para retry de revoke no provider;
- apos provider revoke bem-sucedido, falha de Vault vira `OAUTH_LOCAL_REVOKE_PENDING`, evitando revogar repetidamente o provider;
- o worker de manutencao processa retries com backoff.

Meta sem mecanismo de revoke implementado no adapter recebe revogacao local imediata. Google usa a primitiva de revogacao do I3.

## Seguranca

- nenhum callback/revoke aceita `gymId` ou `tenantId` livre;
- refresh usa o `oauthAppConnectionId` GLOBAL persistido no momento da autorizacao;
- app e tenant precisam continuar no mesmo provider/ambiente;
- tokens permanecem exclusivamente no Vault;
- lease e promocao usam CAS/transaction SERIALIZABLE;
- falha nao aumenta autoridade e nao reativa conexao desconectada;
- AuditLog recebe apenas provider, versao, timestamps, contadores e estados sanitizados.

## Limite do gate

Este WP certifica engenharia interna de I4/I8.

Nao declarar refresh/revoke fisicamente homologados antes de:

- C Gate real do Integration Secret Vault;
- Google OAuth real com refresh/revoke em HOMOLOG;
- Meta App real e mecanismo aplicavel de disconnect/deauthorize quando exigido pelo capability;
- evidencias reproduziveis de concorrencia, expiracao e provider outage.

I6 (Communication Dispatch Boundary) e I7 (Scopes & Least Privilege) permanecem proximos no Macro I.
