# IRON — Bloco 3: SaaS Billing FM → Academia

Status: CERTIFIED — implementação interna concluída e certificada.

## Autoridade e separação

Este bloco implementa cobrança FM Tecnologia → academia. Não reutiliza nem altera o domínio academia → aluno (Subscription, Charge, FinancialTransaction).

A autoridade de acesso continua exclusivamente em TenantProductSubscription + Product/Plan/Feature. SaasBillingAgreement registra estado financeiro/comercial e referencia a assinatura SaaS canônica; nunca concede acesso sozinho.

## Pricing e lifecycle

SaasPlanPrice associa uma versão PUBLISHED de ProductPlanVersion a priceCode, moeda ISO e intervalo mensal/anual. Mudança comercial relevante cria novo priceCode.

Pagamento confirmado é a única operação que pode converter trial em paid ou efetivar upgrade. A mudança de entitlement usa TenantProductSubscriptionLifecycleService.transitionWithTx dentro da mesma transação do ledger.

Regras:
- UPGRADE: delta proporcional imediato do período restante (IMMEDIATE_REMAINING_PERIOD_DELTA).
- DOWNGRADE: próximo período, sem refund imediato (NO_IMMEDIATE_REFUND_EFFECTIVE_NEXT_PERIOD).
- mensal ↔ anual exige operação administrativa dedicada.

## Provider boundary e segurança

O domínio usa SaasBillingProviderPort. Neste bloco só existe INTERNAL_SANDBOX, destinado à certificação interna determinística.

O sandbox exige opt-in explícito, segredo HMAC de pelo menos 32 caracteres e é proibido em NODE_ENV=production. Ele não representa gateway externo homologado e não produz claim de cobrança real.

Webhook normalizado usa HMAC SHA-256, payload canônico e timingSafeEqual. Unicidades físicas de eventId, paymentRef e requestId protegem contra replay e duplicação. Tenant de checkout/cancel/change-plan vem da identidade autenticada; DTO não aceita gymId.

## Recorrência, dunning e reativação

Recorrência cria SaasInvoice com idempotencyKey determinística por agreement/período.

Inadimplência:
1. PAST_DUE;
2. após SAAS_BILLING_DUNNING_GRACE_DAYS, SUSPENDED;
3. TenantProductSubscription canônica também é suspensa;
4. entitlements falham fechado porque exigem ACTIVE.

Pagamento posterior pode reativar a assinatura canônica quando não existe outra ACTIVE conflitante.

## Cancelamento, refund e reconciliation

Cancelamento imediato cancela a assinatura canônica e checkouts pendentes. atPeriodEnd é materializado pelo runner na fronteira do período.

Refund é SUPER_ADMIN, idempotente, limitado ao valor pago e não altera entitlement automaticamente.

Reconciliation compara agreement × assinatura canônica e invoice × ledger de pagamentos.

Pagamento confirmado produz SAAS_BILLING_FISCAL_HANDOFF_PENDING_CAPABILITY. É somente handoff interno; não significa emissão fiscal real nem homologação externa.

## Fora de escopo

Não há claim de Stripe, Asaas, Mercado Pago ou outro gateway homologado, credencial externa real, cobrança real em produção, emissão fiscal real ou cutover comercial. Provider real deverá implementar o port e ser homologado externamente.

## Gate

Só sai de CANDIDATE após Prisma generate, migration/schema invariants, lint/typecheck, build, regressão, branch CI, PR CI + mergeability, merge autorizado e CI pós-merge.


## Evidência final de certificação

- candidate HEAD: `c4589bb326cc0756237505583cc5e4cd05c67695`;
- branch CI: run `36210999784` — SUCCESS;
- PR: #58 — `feat(billing): certify FM-to-academy SaaS billing lifecycle`;
- PR CI: run `36211065747` — SUCCESS;
- merge por squash em `main`: `5b8125a2d8ef5ae6ad7f4981706a2a7e64660018`;
- pós-merge CI: run `36211115952` — SUCCESS.

A certificação é estritamente interna e provider-neutral. O único provider deste bloco continua sendo `INTERNAL_SANDBOX`, proibido em produção; portanto não existe claim de gateway externo homologado, cobrança real, emissão fiscal real ou cutover comercial.
