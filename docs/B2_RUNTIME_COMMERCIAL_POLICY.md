# IRON — Macro B — Runtime Commercial Policy

Status: **CANDIDATE — aguardando CI/PR/merge/post-merge**

## Objetivo

Fazer o runtime consumir a Launch Capability Matrix APPROVED como autoridade comercial real, eliminando dependência de deploy para alterar trial, vencimento de invoice, grace period e ofertas vendáveis.

## Autoridades

Permanecem separadas:

- `ProductPlanVersion`: versão semântica do plano;
- `ProductPlanEntitlement`: capabilities/limites/policies;
- `SaasPlanPrice`: preço cadastrado;
- `CommercialLaunchMatrix APPROVED`: quais preços e capacidades estão comercialmente oferecidos no launch;
- `CommercialLaunchPolicy`: trial e políticas globais do launch.

## Mudanças de runtime

### Trial

O runtime não usa mais:

- `IRON_FIT_TRIAL_PLAN_CODE`;
- `IRON_FIT_TRIAL_DAYS`.

Ele exige matriz APPROVED íntegra e usa exatamente:

- `trialPlanVersionId`;
- `trialDays`.

Não existe busca por "última versão do planCode". O contrato aprovado aponta para uma versão exata.

### Billing

O runtime não usa mais:

- `SAAS_BILLING_INVOICE_DUE_DAYS`;
- `SAAS_BILLING_DUNNING_GRACE_DAYS`.

Recurrence e dunning usam a política da matriz APPROVED.

Preço ativo no banco não significa automaticamente "à venda". Para listagem pública/comercial, checkout e troca de plano, o `priceId` precisa estar nos `CommercialLaunchOffering` da matriz APPROVED.

### O que continua técnico

Este incremento não move configuração técnica/segredo para política comercial.

Continuam fora da Launch Matrix:
- seleção técnica do billing adapter enquanto H não homologa provider real;
- segredo HMAC do sandbox;
- credenciais externas;
- runtime environment;
- Vault/KMS.

Esses dados pertencem às autoridades de IntegrationConnection/Vault/runtime, não à política comercial.

## Fail-closed

Sem matriz APPROVED, com hash divergente, política incompleta, trial desabilitado ou preço fora dos offerings:

**a operação comercial falha fechada.**

Não existe fallback para variáveis de ambiente.

## B6

O B6 passa a criar uma Launch Matrix determinística no banco de teste usando a mesma autoridade de serviço. Isso prova que o caminho E2E depende de dados comerciais persistidos em vez de `.env`.

A matriz B6 é fixture de certificação; não representa decisão comercial da produção.
