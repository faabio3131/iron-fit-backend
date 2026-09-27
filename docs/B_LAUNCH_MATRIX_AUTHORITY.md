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

## Limite deste incremento

A autoridade pode ser certificada sem inventar decisões de negócio.

O Gate B só poderá ser fechado quando uma matriz real for preenchida e aprovada por decisão humana, com planos/preços e política fiscal/trial efetivamente definidos.
