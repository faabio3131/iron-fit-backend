# O12 — Billing IRON / Assinatura IRON

Status: **RECONCILED — FM COMMAND AUTHORITY**

Escopo: FM Tecnologia → academia. Este domínio permanece separado do Financeiro Academia (academia → aluno).

## CURRENT reconciliado

O engine histórico de SaaS Billing do IRON permanece no código apenas como implementação legada/compatibilidade e fonte de leitura enquanto a migração para o FM Command é concluída.

Ele contém:
- preços publicados;
- checkout idempotente;
- upgrade/downgrade;
- cancelamento;
- invoices;
- recorrência;
- dunning;
- refund;
- reconciliation;
- provider boundary interno.

Essas capacidades **não são mais expostas como autoridade pública de mutação do IRON**.

## Autoridade atual

A autoridade de billing FM Tecnologia → academia é exclusivamente:

**FM Command**

O IRON não aceita mais localmente:
- criação de preço;
- checkout;
- troca de plano;
- cancelamento;
- refund;
- recurrence;
- dunning;
- reconcile;
- webhook de provider.

Rotas públicas mutantes foram removidas do `SaasBillingController`.

## Superfície de compatibilidade

Permanecem apenas:

- `GET /saas-billing/authority`
- `GET /saas-billing/prices`
- `GET /saas-billing/current`

`GET /saas-billing/authority` declara:

- `billingAuthority = FM_COMMAND`;
- `localMutationsEnabled = false`;
- `providerWebhooksAccepted = false`;
- `mode = COMMAND_CENTRALIZED`.

`GET /saas-billing/current` expõe somente projeção legada read-only e inclui:

- `projection = LEGACY_READ_ONLY`;
- metadados de autoridade FM Command.

Essa projeção não concede autoridade comercial ao IRON e deve ser substituída pela leitura canônica do Command assim que o contrato runtime de billing por produto estiver disponível.

## Segurança

- tenant continua derivado da identidade autenticada;
- leitura continua protegida por OWNER/SUPER_ADMIN + step-up;
- Financeiro Academia não é reutilizado;
- webhook externo não entra mais pelo runtime IRON;
- gateway/provider FM pertence ao Command;
- nenhuma credencial de provider deve existir na superfície do tenant IRON.

## Próximo gate

Fechar a jornada canônica no Command:

**plano → subscription → invoice → gateway FM → payment confirmation → Command → entitlement/licença IRON**

Somente então a UI “Assinatura IRON” poderá reativar ações comerciais através de contrato governado do Command.
