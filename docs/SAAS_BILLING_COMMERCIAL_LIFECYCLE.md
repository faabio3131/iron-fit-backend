# IRON — SaaS Billing FM → Academia

Status: **LEGACY ENGINE / READ-ONLY COMPATIBILITY**

## Autoridade reconciliada

Este domínio foi originalmente implementado como billing FM Tecnologia → academia dentro do IRON.

A autoridade corporativa atual foi alterada:

**FM Command é a única autoridade de billing FM Tecnologia → academia.**

O Financeiro Academia (academia → aluno) continua separado e permanece no IRON.

## O que permanece no IRON

As tabelas, services e regras históricas permanecem temporariamente para:

- compatibilidade;
- leitura de histórico;
- migração controlada;
- auditoria;
- regressão de invariantes;
- rollback técnico enquanto a migração não for encerrada.

Esse código não deve ser confundido com autoridade comercial ativa.

## O que não é mais público no IRON

O `SaasBillingController` não expõe mais rotas locais de:

- criação de preço;
- checkout;
- change-plan;
- cancel;
- refund;
- recurrence;
- dunning;
- reconcile;
- provider webhook.

A superfície pública ficou read-only:

- `GET /saas-billing/authority`;
- `GET /saas-billing/prices`;
- `GET /saas-billing/current`.

## Estado canônico de acesso

A autoridade de entitlement continua em `TenantProductSubscription` / Product / Plan / Feature.

Mudanças comerciais vindas do FM Command entram exclusivamente pelo control plane governado:

`POST /control-plane/fmcc/subscription/commands`

Esse contrato exige:

- token server-to-server;
- correlation ID;
- idempotency key;
- tenant/gym binding;
- expected subscription ID;
- audit;
- replay protection;
- lifecycle canônico.

Webhook de gateway nunca concede entitlement diretamente no IRON.

## Engine legado

O engine histórico ainda contém:

- `SaasPlanPrice`;
- `SaasBillingAgreement`;
- `SaasCheckoutSession`;
- `SaasInvoice`;
- `SaasPayment`;
- `SaasRefund`;
- `SaasWebhookEvent`;
- `SaasBillingReconciliation`;
- adapter `INTERNAL_SANDBOX`;
- regras de upgrade, downgrade, dunning e refund.

Ele não deve ser removido até migração/reconciliação final provar que não existe dependência operacional ou histórica.

## Provider boundary

Providers, contas recebedoras, webhook e credenciais FM pertencem ao FM Command.

O tenant IRON não configura gateway da FM.

O antigo `INTERNAL_SANDBOX` permanece apenas para testes internos do engine legado e continua proibido em produção.

## Próximo gate

A migração só estará totalmente concluída quando o FM Command possuir jornada genérica e certificada por produto para:

- customer;
- plan/subscription;
- invoice;
- checkout;
- payment confirmation;
- dunning;
- cancellation;
- refund;
- reconciliation;
- entitlement outbox/control-plane.

Até lá, o IRON permanece fail-closed para novas mutações locais de billing FM→academia.
