# IRON — Macrobloco B — Launch Capability Matrix e autoridade comercial

Status: **IN_PROGRESS — mecanismo técnico implementado; decisões humanas ainda não aprovadas**

## Princípio

Código implementa capacidades. Configuração decide:

- quais capacidades entram no launch;
- quais planos/versionamentos/preços são ofertados;
- trial;
- invoice due;
- dunning grace;
- upgrade/downgrade;
- cancelamento;
- refund;
- fiscal;
- canais/providers/mobile LAUNCH, OUT ou EXTERNAL_BLOCKER.

Nenhuma academia, nome de plano ou pacote comercial deve virar condicional de domínio.

## Autoridade persistente

`CommercialLaunchMatrix` possui versão e estados:

- `DRAFT`;
- `APPROVED`;
- `RETIRED`.

Uma matriz aprovada é congelada por `snapshotHash`.

Itens usam:

- `LAUNCH`;
- `EXTERNAL_BLOCKER`;
- `OUT`;
- `UNDECIDED` somente enquanto DRAFT.

A aprovação falha se existir decisão obrigatória ausente ou `UNDECIDED`.

## Relação com ProductPlan

A Launch Matrix não duplica catálogo de produto.

Ela referencia:

`ProductPlan -> ProductPlanVersion -> ProductPlanEntitlement -> SaasPlanPrice`

e valida que offerings do launch apontam para versões `PUBLISHED` e preços ativos.

Capabilities OUT/EXTERNAL_BLOCKER vinculadas a feature key não podem continuar abertas nos offerings aprovados.

## Políticas comerciais

`CommercialLaunchPolicy` governa:

- trial habilitado;
- versão exata do plano de trial;
- dias de trial;
- dias para vencimento de invoice;
- grace period de inadimplência;
- política de upgrade;
- política de downgrade;
- política de cancelamento;
- política de refund;
- modelo fiscal.

Após este WP, trial e parâmetros de cobrança deixam de usar:

- `IRON_FIT_TRIAL_PLAN_CODE`;
- `IRON_FIT_TRIAL_DAYS`;
- `SAAS_BILLING_INVOICE_DUE_DAYS`;
- `SAAS_BILLING_DUNNING_GRACE_DAYS`.

O runtime consome somente a matriz `APPROVED`.

## Trial

Novo trial usa a `trialPlanVersionId` exata congelada na matriz aprovada, não "última versão por planCode".

Depois de provisionado, a identidade histórica de trial vem de `CommercialTrialProvisioning.subscriptionId`. Assim, aprovar uma futura Launch Matrix não transforma trial antigo em assinatura paga nem impede sua expiração.

## Billing

Recurrence e dunning leem `invoiceDueDays` e `dunningGraceDays` da política aprovada.

O `INTERNAL_SANDBOX` continua sendo infraestrutura interna de teste, explicitamente proibida em produção. A seleção de provider real e credencial física pertence aos Macroblocos C/H e não é simulada por esta política.

## Aprovação humana ainda necessária

Este mecanismo não escolhe por conta própria:

- Android/iOS LAUNCH ou OUT;
- AI;
- Creator Network;
- Wellhub;
- TotalPass;
- Meta/Google;
- modelo fiscal definitivo;
- catálogo final de planos/preços;
- trial comercial final;
- política final de refund/cancelamento.

Essas decisões devem existir como dados DRAFT e somente entram em vigor após aprovação humana com step-up.

## Gate B

O Gate B continua **OPEN** até existir uma Launch Matrix completa e explicitamente aprovada.

A existência da arquitetura e dos endpoints não equivale à aprovação comercial.
