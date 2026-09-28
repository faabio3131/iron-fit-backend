# IRON — Macro B — Gate Decision Ledger

Status: **IN_PROGRESS — decisões comerciais parcialmente confirmadas; Gate B ainda OPEN**

Atualizado em: 2026-09-28

## Objetivo

Consolidar somente decisões comerciais já aprovadas para a Launch Capability Matrix V1, sem transformar hipótese, arquitetura futura ou material de marketing em decisão operacional.

Este ledger não substitui a `CommercialLaunchMatrix` persistida. Ele prepara a entrada auditável para criação/aprovação da matriz real quando houver ambiente físico e banco CURRENT disponíveis.

## Decisões já confirmadas

### Superfícies obrigatórias

Conforme Cronograma Mestre e autoridade codificada:

- `surface.core` → `LAUNCH`
- `surface.web` → `LAUNCH`
- `service.email` → `LAUNCH`
- `service.billing` → `LAUNCH`
- `content.external_youtube` → `LAUNCH`

### Mobile e IA

Decisões explicitamente aprovadas pelo owner do produto:

- `mobile.android` → `LAUNCH`
- `mobile.ios` → `LAUNCH`
- `ai.workout_generation` → `LAUNCH`
- `ai.content_recommendation` → `LAUNCH`

### Oferta comercial já aprovada

- mensal: **R$ 269/mês**
- anual: **R$ 2.690/ano**
- trial: **30 dias**
- cartão no início do trial: **não exigido**
- limite do trial: **máximo de 15 alunos**
- Enterprise: **sob consulta**, sem preço público congelado neste gate

Esses valores devem ser materializados por `ProductPlanVersion`, `ProductPlanEntitlement`, `SaasPlanPrice` e `CommercialLaunchOffering`; não devem virar constantes de código.

### Política financeira aprovada

- `invoiceDueDays = 0`
- `dunningGraceDays = 7`
- vencimento da recorrência no próprio dia de renovação;
- após o vencimento, o acordo entra em `PAST_DUE`;
- durante 7 dias corridos permanece em recuperação de cobrança;
- após 7 dias de inadimplência, pode transicionar para `SUSPENDED`;
- suspensão não equivale a cancelamento nem exclusão de dados;
- pagamento conciliado deve permitir reativação conforme o provider e o fluxo de billing.

### Conteúdo

- conteúdo público gratuito por provider externo/YouTube faz parte do launch;
- Creator Network comercial/premium não deve ser apresentado como capacidade live sem aprovação/homologação própria.

## Decisões humanas ainda obrigatórias para fechar Gate B

Os itens abaixo **não podem ser inventados pelo código** e permanecem pendentes até aprovação explícita:

| Item | Estado |
|---|---|
| `creator.iron_managed` | UNDECIDED |
| `creator.tenant_private` | UNDECIDED |
| `provider.wellhub` | UNDECIDED |
| `provider.totalpass` | UNDECIDED |
| `channel.meta` | UNDECIDED |
| `channel.google` | UNDECIDED |
| modelo fiscal V1 | UNDECIDED |

As políticas de upgrade, downgrade, cancelamento e refund já possuem apenas opções suportadas pelo runtime atual; a matriz real ainda precisa selecioná-las e ser aprovada por SUPER_ADMIN + step-up.

## Critério de fechamento

Gate B somente passa quando:

1. todos os itens obrigatórios tiverem decisão diferente de `UNDECIDED`;
2. os itens `OUT` / `EXTERNAL_BLOCKER` estiverem fail-closed nos offerings;
3. existir ao menos um offering válido com `ProductPlanVersion` publicada e preço ativo;
4. trial, invoice, dunning e políticas comerciais estiverem completos;
5. `fiscalMode` não estiver `UNDECIDED`;
6. a matriz real for aprovada pelo fluxo `SUPER_ADMIN + step-up`;
7. o snapshot hash canônico estiver persistido e a leitura `currentApproved()` retornar `integrity=PASS`.

## Estado do gate

**GATE B: OPEN / IN_PROGRESS**

A autoridade técnica está implementada e certificada. Mobile, IA e política financeira já estão aprovados. O fechamento depende das decisões restantes sobre Creator, agregadores, Meta/Google, fiscal e da materialização/aprovação da matriz real.
