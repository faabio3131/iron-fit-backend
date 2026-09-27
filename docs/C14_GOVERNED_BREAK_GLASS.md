# IRON — Commercial Readiness — C14 Governed Break-glass

Status: **CANDIDATE — aguardando CI/PR/merge/post-merge**

## Objetivo

C14 permite uso excepcional e controlado de uma credencial de integração em incidente real sem criar um "admin que lê todos os segredos".

Não existe endpoint de reveal, download ou leitura de plaintext.

## Autoridade

Todas as rotas são:

- JWT autenticado;
- role `SUPER_ADMIN`;
- ambiente derivado de `IRON_RUNTIME_ENV`.

Operações críticas exigem step-up e **MFA habilitado obrigatoriamente**, mesmo para SUPER_ADMIN.

## Dual control

Um break-glass exige:

1. SUPER_ADMIN A solicita;
2. SUPER_ADMIN B, usuário distinto, aprova;
3. somente o solicitante A pode consumir o grant aprovado.

O banco possui constraint que impede `approvedByUserId == requestedByUserId`.

## TTL

TTL solicitado:

- mínimo: 60 segundos;
- máximo: 900 segundos (15 minutos).

O TTL começa na aprovação.

Grants aprovados vencidos são promovidos a `EXPIRED` antes de novas operações.

## Uso único

Estado:

`REQUESTED -> APPROVED -> EXECUTING -> CONSUMED`

ou:

- `FAILED`;
- `REVOKED`;
- `EXPIRED`.

A transição para `EXECUTING` é um claim condicional que impede replay/concurrent consume.

Mesmo falha do provider consome a tentativa, movendo o grant para `FAILED`.

## Operações permitidas

Nesta versão existe somente:

`PROVIDER_VERIFY`

A credencial:

1. é recuperada server-side do Vault;
2. tem versão/expiração verificadas;
3. é embrulhada em `IntegrationSecretValue`;
4. é entregue somente ao provider probe registrado;
5. nunca é retornada ao administrador.

Adicionar nova operação break-glass exige código, testes e revisão explícita; não existe executor genérico de comandos ou segredo.

## Segredos e auditoria

`IntegrationBreakGlassGrant` guarda:

- connectionId;
- operação;
- justificativa;
- requester/approver;
- TTL e timestamps;
- status.

Ele não guarda:

- `secretReference`;
- plaintext;
- token;
- API key;
- private key.

A justificativa rejeita padrões de credencial conhecidos.

Eventos auditados:

- REQUESTED;
- APPROVED;
- CONSUMED;
- FAILED;
- REVOKED.

AuditLog recebe IDs, provider, operação e timestamps; nunca conteúdo secreto.

## Regra de autoridade

Break-glass não:

- altera plano/entitlement;
- muda tenant;
- troca environment;
- rotaciona credencial;
- reativa conexão DEGRADED;
- ignora revogação/expiração;
- oferece leitura irrestrita de Vault.

O único efeito adicional de PROVIDER_VERIFY bem-sucedido é atualizar `lastVerifiedAt`; o status da conexão não é elevado automaticamente.

## Limite

A mecânica pode ser certificada internamente com Vault/probe simulados.

Uso contra OCI/provider real só será evidência física quando C4 e os providers externos estiverem efetivamente homologados.
