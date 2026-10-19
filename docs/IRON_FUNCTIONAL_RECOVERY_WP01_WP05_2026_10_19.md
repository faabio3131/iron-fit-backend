# IRON FIT CORE — 19/10/2026 — Execucao da auditoria funcional 1 a 5

Fonte: auditoria de paridade Web/Mobile/Backend 19/10/2026 e CURRENT real. Nao repetir capacidades existentes. Metodo: AUDITAR → IMPLEMENTAR GAP → TESTAR → CORRIGIR → RETESTAR → DIFF → PR → CI → MERGE (gate) → POS-MERGE.

| Sequencia | WP | Gate obrigatorio | Condicao |
|---|---|---|---|
| 1 | WP01 P0: revisao humana de treinos, PR #121, origem do aprovador, estado e concorrencia | HTTP e unitarios negativos, isolamento tenant, CI/pos-merge | Backend protege ACTIVE de PENDING_REVIEW/DRAFT |
| 2 | WP02 P0: 16 migrations HOMOLOG, IntegrationConnection, fiscal, privacy e Command | backup externo restauravel + restore em clone isolado + ensaio Prisma + migrations + smoke | sem DDL destrutivo no banco real sem prova de restore |
| 3 | WP03 P0: perfis e RBAC, reconciliar #112/#116 (nao restaurar rotas antigas de billing) | seis roles, permissions, tenant, step-up/MFA, API HTTP, CI | sem escalonamento/vazamento |
| 4 | WP04 P1: FM Command → assinatura/licenca/entitlements IRON; controller IRON read-only | S2S autenticado, idempotencia, replays, tenancy, audit, estados comerciais | schema do WP02 antes E2E HOMOLOG |
| 5 | WP05 P1: Web/Mobile parity, checkout academia→aluno usando API atual, IRON Intelligence apropriada, #120, clicaveis e mensagens | testes reais por perfil/operacao; CI app/backend; preview do IRON REAL | role + entitlement; provider sem homologacao falha fechado |

Checkpoint: main backend ee5aadfd2a14b8c5b91b7a7d4fbcd5d65f0162ef; PR app visual #22 head 847754309aba1752c525831a654e05797fc55ecd CI #367 SUCCESS deploy LIVE; HOMOLOG 28/44 migrations e 16 pendentes. Somente CI executada neste HEAD pode confirmar WP. A construcao interna nao depende de homologacao de provider real: classificar externo como EXTERNAL BLOCKER/OUT. PR visual #22 SEM MERGE ate aprovacao visual explicita O23/O24. Continuar Macro P→T apos gates.
