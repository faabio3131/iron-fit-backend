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

### Conteúdo, agregadores e canais externos

- conteúdo público gratuito por provider externo/YouTube faz parte do launch;
- `creator.iron_managed` → `OUT` na V1, preservado no roadmap oficial IRON-CREATOR;
- `creator.tenant_private` → `OUT` na V1; tenant-owned storage permanece evolução futura;
- `provider.wellhub` → `EXTERNAL_BLOCKER`; arquitetura Aggregator Hub preservada, homologação depende de parceiro/credenciais/evidência externa;
- `provider.totalpass` → `EXTERNAL_BLOCKER`; arquitetura Aggregator Hub preservada, homologação depende de parceiro/credenciais/evidência externa;
- `channel.google` → `LAUNCH`;
- `channel.meta` → `LAUNCH`, como autoridade guarda-chuva para o ecossistema Meta suportado na V1: **Facebook, Instagram e WhatsApp**.

Google e Meta devem obedecer ao padrão mestre FM de configuração externa:

- novo cliente = configuração, nunca alteração de código;
- OAuth/configuração por tenant;
- `IntegrationConnection + Vault` como autoridade;
- app/config global quando aplicável + tokens tenant-scoped;
- nenhum client secret, refresh token, API key ou account ID hardcoded;
- nenhum caminho privilegiado por cliente/academia;
- rotação/revogação/reautorização governadas;
- integração só recebe status homologado/live com evidência externa real.

### Fiscal V1

- modelo fiscal → `PROVIDER_NFSE`;
- integração pelo FM Fiscal Core / contrato universal já preparado;
- homologação externa de provider/prefeitura/credenciais permanece separada e não pode ser inventada.

## Decisões humanas restantes

Não há mais decisão de capability/canal pendente entre os itens obrigatórios do escopo V1.

As políticas de upgrade, downgrade, cancelamento e refund já possuem apenas opções suportadas pelo runtime atual; a matriz real ainda precisa selecioná-las/materializá-las e ser aprovada por SUPER_ADMIN + step-up.

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

A autoridade técnica está implementada e certificada. Mobile, IA, política financeira, Creator V1, agregadores, Google, Meta (Facebook/Instagram/WhatsApp) e modelo fiscal já estão classificados. O fechamento depende da materialização das políticas/ofertas na matriz real e da aprovação governada por SUPER_ADMIN + step-up.
