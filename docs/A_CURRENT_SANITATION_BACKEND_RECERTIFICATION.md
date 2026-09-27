# IRON — Macrobloco A — Backend Repin e Reconciliação

Status: CANDIDATE até branch CI, PR CI, merge e pós-merge verdes.

## Objetivo

Fechar A5–A7 do Cronograma Mestre de Commercial Readiness:

- repinar o B6 para o app CURRENT saneado;
- reexecutar toda a certificação integrada sobre PostgreSQL real e HTTP real;
- remover documentação histórica que declarava produção/infraestrutura não comprovadas.

## Par certificado

App CURRENT saneado:

`d05b10ec7995ae55d5a9a4f6104234decc9e16b8`

O workflow do backend deve fazer checkout exatamente desse SHA no passo cross-surface.

## Gate obrigatório

A branch só pode avançar quando todos os passos canônicos estiverem verdes:

- dependency audit;
- Prisma generate;
- fresh migrations em PostgreSQL real;
- lint/typecheck;
- build;
- regressão;
- seed B6;
- backend real iniciado;
- Integrated Live E2E;
- app CURRENT instalado;
- live app client contra backend;
- container backend.

## Reconciliação documental

`docs/ARQUITETURA.md` passa a descrever o CURRENT e remove claims históricos incompatíveis, incluindo:

- Render como runtime produtivo;
- Supabase legado como banco produtivo/homologado;
- painel React/Vite paralelo;
- `/auth/register` como signup público comercial;
- `node dist/main` como entrypoint;
- rate limiting/recovery como funcionalidades ausentes.

B4 e B5 também passam a refletir seus estados reais: B4 certificado internamente; B5 certificado no escopo interno, com homologação externa pendente.

Nenhuma dessas correções documentais declara produção real.
