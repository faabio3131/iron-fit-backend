# IRON — Commercial Readiness — C11 Backup/DR Secret Policy

Status: **CANDIDATE — aguardando CI/PR/merge/post-merge**

## Definition of Done do Cronograma Mestre

C11 exige:

- backup do PostgreSQL sem segredo de integração reutilizável;
- recovery do Vault governado;
- restore isolado do banco incapaz de reconstruir credenciais sem Vault/KMS.

## Autoridade de dados

O PostgreSQL pode armazenar somente:

- `secretReference` opaca;
- versão;
- timestamps de rotação/expiração/último uso/verificação/revogação;
- provider, capabilities e configuração pública;
- fila operacional de cleanup contendo somente referência opaca.

O valor reutilizável do segredo pertence exclusivamente ao Vault físico.

## Eliminação de legado

`GatewayConnection` possuía campos históricos:

- `apiKeyEnc`;
- `accessTokenEnc`;
- `refreshTokenEnc`;
- `webhookSecretEnc`.

A migration C11 remove essas colunas.

A migration é deliberadamente fail-closed: se qualquer uma estiver preenchida, o deploy falha e exige externalização governada para `IntegrationConnection + Vault` antes de continuar. Nenhum valor existente é descartado silenciosamente.

## Restore drill

O CI executa um drill real em PostgreSQL:

1. cria uma `IntegrationConnection` GLOBAL contendo somente referência opaca e metadados;
2. gera `pg_dump` completo do banco;
3. verifica que o dump não contém as colunas legadas nem o canary de segredo reutilizável;
4. restaura o dump em um segundo banco PostgreSQL;
5. confirma que o metadata canônico foi restaurado;
6. executa o `IntegrationSecretResolverService` sem Vault físico;
7. exige falha fechada: metadata de DB sozinho nunca resolve a credencial.

## Recovery governado

Rotas administrativas internas:

- `POST /admin/integrations/dr/assess`;
- `POST /admin/integrations/dr/reconcile-fail-closed`.

Ambas exigem:

- JWT autenticado;
- role `SUPER_ADMIN`;
- step-up pela senha atual;
- MFA/recovery code quando MFA estiver habilitado.

O assessment usa somente metadados físicos do Vault. Nenhum valor secreto é devolvido.

O reconcile pode apenas **reduzir autoridade**, marcando como `DEGRADED` conexões ACTIVE cujo segredo físico não possa ser comprovado, esteja expirado ou tenha versão divergente.

Ele nunca:

- recria segredo;
- copia segredo entre ambientes;
- promove conexão para ACTIVE;
- troca referência;
- devolve secretReference;
- devolve plaintext;
- ignora Vault/KMS.

Depois de DR, reativação exige fluxo normal de provider verification/credencial.

## Isolamento de ambiente

O ambiente é sempre `IRON_RUNTIME_ENV`. Restore não permite selecionar PROD/HOMOLOG/DEV via request.

Backups e restores físicos DEV/HOMOLOG/PROD devem permanecer separados.

## Limite desta certificação

Este incremento certifica a política de DB/restore e o comportamento fail-closed usando PostgreSQL real em CI.

A recuperação física de um Vault OCI real, key IAM e restore/replication do secret store continua dependente do C4 físico e da infraestrutura D/E. Ela não será declarada homologada sem evidência externa real.
