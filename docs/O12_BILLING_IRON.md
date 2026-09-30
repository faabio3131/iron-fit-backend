# O12 — Billing IRON / Assinatura IRON

Status: **CANDIDATE**

Escopo: FM Tecnologia → academia. Este domínio permanece separado do Financeiro Academia.

## CURRENT preservado

O domínio SaaS Billing já contém:
- preços publicados;
- checkout idempotente;
- upgrade com delta proporcional;
- downgrade no próximo período;
- cancelamento;
- invoices;
- recorrência;
- dunning;
- suspensão após grace period;
- reativação por pagamento posterior;
- refund administrativo idempotente;
- reconciliation;
- step-up e RBAC.

## Acréscimo O12

`GET /saas-billing/current` passa a fornecer, de forma aditiva:

- `billingPolicy.invoiceDueDays`;
- `billingPolicy.dunningGraceDays`;
- `billingPolicy.gracePeriodEndsAt`.

A política vem exclusivamente da Launch Matrix APPROVED. A Web não calcula nem inventa política comercial.

## Autoridade

- OWNER/SUPER_ADMIN: current, prices, checkout, change-plan, cancel;
- SUPER_ADMIN: refund, recurrence, dunning e reconcile;
- tenant derivado da identidade autenticada;
- Billing IRON nunca reutiliza Financeiro Academia;
- provider externo continua sem claim de produção quando não homologado.
