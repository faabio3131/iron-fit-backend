# IRON — W1 / Macroblocos B + C — Reconciliação CURRENT

Atualizado em: 2026-09-28  
Backend CURRENT base: `7fda9a13155dfb8a3974c26c728bbafb03464540`  
App CURRENT certificado e repinado no B6: `3b0f91e109e31457f903f95182f04d2079349e9b`

## Regra de status

Este documento reconcilia evidência real com o Cronograma Mestre.  
`CERTIFIED_INTERNAL` não significa homologação física, provider real ou produção.

## Macrobloco B — Congelar escopo comercial V1

Status: **DECISION_COMPLETE / MATERIALIZED_DRAFT — GATE B OPEN até aprovação governada real**

### Decisões comerciais V1 congeladas

- `surface.core` → `LAUNCH`
- `surface.web` → `LAUNCH`
- `service.email` → `LAUNCH`
- `service.billing` → `LAUNCH`
- `content.external_youtube` → `LAUNCH`
- `mobile.android` → `LAUNCH`
- `mobile.ios` → `LAUNCH`
- `ai.workout_generation` → `LAUNCH`
- `ai.content_recommendation` → `LAUNCH`
- `channel.meta` → `LAUNCH` como autoridade guarda-chuva para Facebook, Instagram e WhatsApp
- `channel.google` → `LAUNCH`
- `creator.iron_managed` → `OUT` na V1, roadmap preservado
- `creator.tenant_private` → `OUT` na V1
- `provider.wellhub` → `EXTERNAL_BLOCKER`
- `provider.totalpass` → `EXTERNAL_BLOCKER`
- fiscal → `PROVIDER_NFSE`

### Oferta comercial V1 congelada

- mensal: R$ 269,00;
- anual: R$ 2.690,00;
- trial: 30 dias;
- cartão no início do trial: não exigido;
- trial limitado a 15 alunos;
- `invoiceDueDays = 0`;
- `dunningGraceDays = 7`;
- upgrade: `IMMEDIATE_PRORATED`;
- downgrade: `NEXT_PERIOD_NO_IMMEDIATE_REFUND`;
- cancelamento: `IMMEDIATE_OR_PERIOD_END`;
- refund: `SUPER_ADMIN_MANUAL`.

### Autoridade persistida

PR #88 introduziu e certificou:
- manifesto canônico `config/commercial/iron-v1-launch.json`;
- planos `IRON_V1_TRIAL` e `IRON_V1`;
- preços persistidos mensal/anual;
- capability `commercial.trial_students_max` como LIMIT persistido;
- enforcement do teto de 15 alunos no fluxo de criação de aluno durante trial;
- materializador `commercial:materialize-v1`;
- validação não-mutante do DRAFT pelos mesmos critérios da aprovação;
- impossibilidade do materializador chamar `approve()` ou autopromover para `APPROVED`.

Evidência:
- PR #88 CI `36370290264` — SUCCESS;
- squash merge `7fda9a13155dfb8a3974c26c728bbafb03464540`;
- pós-merge `36370475395` — SUCCESS.

### O que ainda falta para fechar Gate B

O escopo e as decisões já não estão pendentes.

Resta somente materializar o manifesto no ambiente físico oficial e executar a aprovação real pelo fluxo existente:
- usuário global `SUPER_ADMIN` ativo;
- step-up/MFA conforme política;
- `POST /commercial-launch/matrices/:id/approve`;
- snapshot hash canônico persistido;
- `currentApproved()` retornando `integrity=PASS`.

Essa aprovação não será falsificada por CI ou fixture.

## Macrobloco C — Integration & Secret Vault

Status: **IN_PROGRESS / BLOCKED_EXTERNAL — GATE C OPEN**

| WP | Estado CURRENT | Evidência / limite |
|---|---|---|
| C1 Provider Registry | CERTIFIED_INTERNAL | Registry provider-neutral persistido no runtime e catálogo seguro. |
| C2 Connection Authority | CERTIFIED_INTERNAL | GLOBAL/TENANT + gymId + provider + environment; lookup scoped/fail-closed. |
| C3 Secret Reference | CERTIFIED_INTERNAL | `isv_...` opaca; DB sem valor reutilizável. |
| C4 Vault Backend | BLOCKED_EXTERNAL | Adapter OCI integrado, mas Vault/KMS/IAM real ainda não foi fisicamente provisionado/homologado. |
| C5 Secret Resolver | CERTIFIED_INTERNAL | Resolve server-side e valida scope/env/status/version/revogação/expiração. |
| C6 Write-only Admin UX/API | CERTIFIED_INTERNAL | API + Web OWNER; create/replace/rotate/verify/revoke; sem reveal. |
| C7 Step-up & MFA | CERTIFIED_INTERNAL | Operações críticas protegidas por AuthSecurityService; break-glass exige MFA. |
| C8 Lifecycle | CERTIFIED_INTERNAL | version/rotated/expires/lastUsed/lastVerified/revoked + cleanup persistente. |
| C9 Audit & Redaction | CERTIFIED_INTERNAL | Sanitização estrutural + audit sem segredo. |
| C10 Env Isolation | CERTIFIED_INTERNAL / PHYSICAL_PENDING | DEV/HOMOLOG/PROD fail-closed; namespaces físicos dependem C4/D. |
| C11 Backup/DR Secret Policy | CERTIFIED_INTERNAL / PHYSICAL_PENDING | backup/restore CI prova DB sem segredo reutilizável; recovery físico depende C4/D/E. |
| C12 Adversarial Tenant Isolation | PARTIAL_CERTIFIED | Resolver/admin/connection cobertos; callback/webhook fecha com H/I reais. |
| C13 Secret Scanning CI | CERTIFIED_INTERNAL | Gate permanente antes de build/testes. |
| C14 Break-glass | CERTIFIED_INTERNAL / PHYSICAL_PENDING | dual control, MFA, TTL, one-shot verify; uso real depende C4/provider. |

## Gate W1

**OPEN**, corretamente.

Motivos restantes:
1. Gate B depende apenas da aprovação governada da matriz materializada no ambiente físico oficial.
2. Gate C exige Vault OCI real e isolamento físico/lógico; C4 permanece `BLOCKED_EXTERNAL`.
3. C12 callback/webhook adversarial depende das superfícies H/I.

## Trabalho independente liberado

O Cronograma Mestre determina que blocker externo não deve impedir trabalho independente.

Portanto:
- D pode continuar em tudo que não exigir capacidade externa indisponível;
- E só fecha após D físico;
- F pode avançar em contratos/topologia sem declarar URLs oficiais inexistentes;
- G/H/I/K não podem ser homologados como provider real antes do Gate C;
- documentação CURRENT deve continuar refletindo blockers reais sem promoção indevida.
