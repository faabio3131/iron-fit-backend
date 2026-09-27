# IRON — Commercial Readiness — C1–C3 Integration & Secret Vault Foundation

Status: **CANDIDATE — aguardando CI/PR/merge/post-merge**

## Escopo

Este incremento implementa somente a fundação anterior ao Vault físico:

- C1 — Integration Provider Registry;
- C2 — Integration Connection Authority;
- C3 — Secret Reference Contract.

Não existe provider comercial real, credencial, OAuth callback, webhook público, KMS/Vault físico ou endpoint administrativo neste incremento.

## C1 — Registry

IntegrationProviderRegistry registra contratos internos por providerCode com capabilities, auth models, environments homologáveis e suporte declarado a webhook/OAuth. O Registry não contém SDK, endpoint, token ou regra de negócio vendor-specific.

## C2 — Connection Authority

IntegrationConnection separa explicitamente GLOBAL (FM/plataforma, gymId nulo) e TENANT (academia, gymId obrigatório). DEV/HOMOLOG/PROD faz parte da identidade da conexão. O banco impõe o shape e unicidade parcial por provider/environment.

IntegrationConnectionService.findScopedById busca sempre por id + scope + gymId, preparando fail-closed cross-tenant antes da futura API administrativa.

## Public configuration não é cofre

publicConfiguration aceita somente metadados não secretos. A validação recursiva bloqueia campos com nomes equivalentes a token, secret, password, API key, client secret, private key, credential, authorization, CVV/PAN.

## C3 — Secret Reference

A referência canônica é opaca e aleatória no formato isv_<base64url-32-bytes>. Ela não contém tenant, provider, caminho físico do Vault ou segredo. A coluna permanece nullable porque C4 ainda não existe.

C4 será responsável por criar o segredo no backend físico e somente então associar a referência válida à conexão.

## Segurança preservada

- nenhuma credencial real em código, migration, fixture ou docs;
- nenhuma API para ler/escrever segredo;
- nenhum .env por cliente;
- nenhum provider real ativado;
- nenhuma mudança em billing, Meta, Google, Wellhub, TotalPass ou Creator;
- migration aditiva;
- cross-tenant lookup fail-closed.

## Próximo gate

Executar dependency audit, Prisma generate, fresh migrations PostgreSQL, lint/typecheck, build e regressão completa. Somente após C1–C3 serem certificados deve iniciar C4 — Vault Backend físico.
