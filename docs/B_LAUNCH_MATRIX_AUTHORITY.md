# IRON — Macro B — Launch Capability Matrix Authority

Status: **CANDIDATE — implementação da autoridade; decisões comerciais ainda não preenchidas**

## Objetivo

O Cronograma Mestre exige uma Launch Capability Matrix aprovada antes do Gate B.

Este incremento cria a autoridade persistente e versionada para essa aprovação sem hardcode de plano, preço, tenant ou provider.

## Separação de autoridades

- `ProductCapabilityDefinition`: define capability técnica.
- `ProductPlanVersion + ProductPlanEntitlement`: define o que cada versão de plano concede.
- `SaasPlanPrice`: define preços comerciais.
- `CommercialLaunchMatrix`: decide quais superfícies/canais/providers/capabilities entram no lançamento.
- `CommercialLaunchOffering`: referencia exatamente os preços/versões de plano oferecidos no launch.
- `CommercialLaunchPolicy`: congela trial e políticas comerciais globais do launch.

A matriz não duplica preços nem entitlements.

## Lifecycle

`DRAFT -> APPROVED -> RETIRED`.

Somente DRAFT é editável.

A aprovação:
- exige SUPER_ADMIN;
- exige step-up existente;
- valida todas as decisões obrigatórias do Cronograma;
- valida plano/preço publicados e ativos;
- valida políticas comerciais completas;
- valida que item `OUT` ou `EXTERNAL_BLOCKER` ligado a feature permaneça fail-closed nos offerings;
- produz SHA-256 canônico do snapshot;
- aposenta a matriz APPROVED anterior;
- torna o snapshot aprovado imutável.

## Requisitos do Cronograma codificados como governança, não como pacote

Obrigatórios como `LAUNCH`:
- Core;
- Web;
- E-mail;
- Billing.

Obrigatórios como **decisão humana explícita**, sem valor predefinido:
- Android;
- iOS;
- AI workout;
- AI content recommendation;
- Creator IRON-managed;
- Creator tenant-private;
- Wellhub;
- TotalPass;
- Meta;
- Google.

O código não decide se esses itens opcionais são LAUNCH, EXTERNAL_BLOCKER ou OUT.

## Políticas comerciais

A matriz congela por dados:
- trial ligado/desligado;
- versão exata do plano de trial, quando ligado;
- quantidade de dias de trial;
- vencimento de invoice;
- grace period de dunning;
- política de upgrade;
- política de downgrade;
- cancelamento;
- refund;
- modelo fiscal.

Apenas políticas já suportadas pelo runtime podem ser selecionadas. Novo comportamento comercial ainda não implementado exige adapter/regra nova antes de ser selecionável.

## Planos e preços

Um offering referencia `SaasPlanPrice`, que por sua vez referencia a versão do ProductPlan.

A aprovação rejeita:
- versão não PUBLISHED;
- preço inativo;
- preço fora da janela de vigência;
- price/planVersion inconsistentes.

Não existe nome de plano hardcoded.

## Fail-closed

Se um item possuir `featureKey` e for `OUT` ou `EXTERNAL_BLOCKER`, nenhuma versão de plano oferecida no launch pode conceder valor efetivo não-fechado para essa feature.

A aprovação falha se houver contradição.

## Runtime authority

Após o hardening de runtime:

- novo trial lê `trialPlanVersionId` e `trialDays` somente da matriz `APPROVED`;
- o plano de trial é uma versão exata, não "último planCode";
- trials históricos são reconhecidos por `CommercialTrialProvisioning.subscriptionId`, preservando expiração mesmo após futura mudança de matriz;
- recorrência lê `invoiceDueDays` da política aprovada;
- dunning lê `dunningGraceDays` da política aprovada.

Deixam de ser autoridades comerciais de deploy:

- `IRON_FIT_TRIAL_PLAN_CODE`;
- `IRON_FIT_TRIAL_DAYS`;
- `SAAS_BILLING_INVOICE_DUE_DAYS`;
- `SAAS_BILLING_DUNNING_GRACE_DAYS`.

O B6 permanente também prova esse contrato: o workflow não injeta mais esses valores em env e o seed cria uma Launch Matrix APPROVED de fixture com snapshot hash no PostgreSQL.

O `INTERNAL_SANDBOX` permanece somente como boundary técnico de teste, proibido em produção. Provider real/credenciais pertencem aos Macroblocos C/H e não são simulados por política comercial.

## Limite deste incremento

A autoridade pode ser certificada sem inventar decisões de negócio.

O Gate B só poderá ser fechado quando uma matriz real for preenchida e aprovada por decisão humana, com planos/preços e política fiscal/trial efetivamente definidos.
