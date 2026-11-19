# O12 — Billing IRON / Assinatura IRON

Status: **RECONCILED — FM COMMAND AUTHORITY ONLY; P3 CLIENT COMMERCIAL E2E OPEN**

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

---

## 2026-11-17 — P3 / Assinatura IRON: pendências descobertas em teste visual real

**Estado:** `OPEN — COMMERCIAL CLIENT JOURNEY NOT CERTIFIED` (autoridade FM Command reconciliada; produto cliente e integração física não certificados).
**Origem:** navegação autenticada como QA IRON OWNER em `app.ironfitcore.com.br`, 17/11/2026; ver código `iron-fit-app/src/components/SaasBillingPanel.tsx` e `src/web/CommercialWebApp.tsx` em `production`, backend `src/modules/commercial/iron-commercial-checkout.{controller,service}.ts` em `production`, FM Command `src/application/billing/iron-commerce-provisioning.ts` e `src/app/api/internal/iron/commerce/checkout/route.ts` em `main`.
**Responsabilidade:** backend IRON = autenticação, tenant, entitlement e proxy mínimo; Web IRON = autosserviço do proprietário; FM Command = autoridade de plano, fatura, pagamento, assinatura e licença; Cakto = checkout e evento de pagamento. **Financeiro academia→aluno não participa dessa jornada.**

### Evidências reproduzíveis — NÃO declarar concluído

1. A Web mostra **“Contratação indisponível até a configuração comercial dos planos”**, sem ofertas nem botões de compra. No `SaasBillingPanel.tsx`, o mesmo texto é usado quando `GET /commercial/billing/offers` falha, retorna lista inválida ou não há ofertas: **causa específica em Contabo não comprovada**; investigar resposta real e logs sanitizados, não presumir ausência de cadastro.
2. O cartão “Situação conhecida no IRON” consulta `GET /saas-billing/current` (`LEGACY_READ_ONLY`). Mostra “Não registrado / Não informado / nenhuma fatura histórica”, que **não é consulta canônica do Command** e não prova falta de assinatura/entitlement do cliente.
3. O fluxo normal renderiza `<SaasBillingPanel canPurchase={can('OWNER')} ... />`. Porém, no ramo `blocked` de `CommercialWebApp.tsx`, renderiza `<SaasBillingPanel ... />` **sem `canPurchase`**, deixando-o `false`: proprietário com trial vencido/suspenso pode ficar sem contratação para regularização. Corrigir preservando proteção server-side e política comercial canônica.
4. O endpoint `GET /commercial/billing/offers` exige JWT, OWNER e step-up. O proxy exige configuração `IRON_FMCC_COMMERCE_URL`/`IRON_FMCC_COMMERCE_TOKEN`; o Command exige sua rota Cakto ativa PROD, controle S2S, ofertas Cakto oficiais, mapeamentos `commercialPlanCode -> IRON plan/version` publicados. A existência do código **não confirma** essas condições no runtime.
5. O endpoint `POST /commercial/billing/checkout` aceita oferta validada, usa idempotência e devolve URL Cakto com fatura canônica; redirecionamento **não concede licença**. Testes unitários/mockados não substituem compra, webhook, outbox e readback reais.
6. A tela mostra texto de arquitetura (autoridade corporativa, engine antigo e “registro local”), em vez de uma experiência comercial clara para proprietário: lacuna de UX mesmo quando backend está correto.

### WPs obrigatórios — ordem de dependência

- [ ] **P3-IRON-01 — Diagnóstico físico sem mutação:** consultar `GET /commercial/billing/offers` com sessão QA OWNER e step-up ativo; diferenciar 401/403, 503, catálogo vazio e falha de contrato; conferir conectividade S2S IRON→Command, estado do catálogo, status de rota e mapeamentos, sem imprimir/alterar secrets. Evidenciar resposta sanitizada, runtime SHA e ambiente.
- [ ] **P3-IRON-02 — Catálogo comercial canônico:** reconciliar quatro planos IRON e ofertas mensais/anuais oficiais, preços, entitlements e versões publicadas; comparar `Command product plan mapping` ↔ `IRON plan/version` ↔ `Cakto offer`; evitar oferta órfã, valor divergente e troca entre mensal/anual. Habilitação comercial externa somente com configuração/credenciais oficiais e gate de segurança.
- [ ] **P3-IRON-03 — Read-model oficial por academia:** fornecer/consumir contrato autenticado S2S **canônico** para plano, status, período, próxima cobrança, faturas/pagamentos e histórico do cliente. Verificar antes se contrato já existe; não inventar API. Distinguir fonte, freshness e `unknown`; não fazer “Não registrado” de dados legados parecer ausência de assinatura real. O Command continua fonte de verdade de billing.
- [ ] **P3-IRON-04 — Recuperação comercial bloqueada:** garantir que OWNER autenticado consiga consultar ofertas e solicitar contratação/regularização mesmo com trial expirado ou assinatura suspensa quando permitido pelo Command; step-up ativo e autorização backend obrigatórios; impedir bypass de acesso operacional/entitlement até pagamento verificado.
- [ ] **P3-IRON-05 — Área do cliente utilizável:** mostrar comparador de planos/preços e periodicidade reais; plano/status atual; próxima renovação; faturas e recibos; histórico; ações de contratar, trocar plano ou cancelar **somente via contratos reais e autorização**. Falhas devem ter mensagens específicas e seguras. Remover jargão interno, JSON, indicadores enganadores; não criar botão inerte.
- [ ] **P3-IRON-06 — Ciclo comercial E2E:** testar cadastro/trial → OWNER → seleção da oferta → fatura idempotente → Cakto real autorizado → webhook assinado validado → ledger/outbox Command → entitlement IRON → atualização da UI; incluir renovação, falha/atraso, grace, suspensão, reativação, upgrade/downgrade, cancelamento/refund quando política autorizar. Sem transação real, `IMPLEMENTED / EXTERNAL BLOCKER`, nunca `PRODUCTION HOMOLOGATED`.
- [ ] **P3-IRON-07 — Segurança, CI e publicação:** regressões de role (OWNER, SUPER_ADMIN, MANAGER, RECEPTION, TRAINER, STUDENT), step-up/MFA, tenant mismatch, spoofing, replay, idempotência, URL de checkout, assinaturas webhook, duplicate/reordered events, valor/ciclo divergentes, cross-tenant, falhas S2S, expiração de sessão. Executar CI backend/Web/Command; auditar diff; merge com gate; conferir versão real Contabo/health; smoke autenticado por academia. Nenhum ambiente é homologado pela aprovação da CI isolada.

### Definition of Done específico / gate de release

- [ ] Na conta QA OWNER, ofertas elegíveis exibidas com **valores e ciclos oficiais verificáveis**, ou estado indisponível com **motivo real e seguro**; erros 401/403/503 não mascarados como “planos não configurados”.
- [ ] Contratação/regularização pelo proprietário funciona inclusive em estado comercial bloqueado, quando elegível; role/step-up/tenant e entitlement não podem ser burlados.
- [ ] Assinatura, faturas e renovação são lidas do Command e correspondem à academia autenticada; projeções legadas identificadas e nunca apresentadas como verdade canônica.
- [ ] Compra real autorizada, webhook, licença e readback certificados em ambiente apropriado; sem evidência externa o gate P3 e `COMMERCIAL E2E PASS` **continuam ABERTOS**.
- [ ] CI e E2E de regressão verdes nos SHAs finais; deploy físico verificado por SHA, health e navegação real; sem cobrança/ativação duplicada nem segredo em logs.

**Dependências:** [Macro P #243](https://github.com/faabio3131/iron-fit-backend/issues/243); [FM Command — código canônico](https://github.com/faabio3131/FM-CONTROL-CENTER); [IRON app — painel atual](https://github.com/faabio3131/iron-fit-app/blob/production/src/components/SaasBillingPanel.tsx).

**Não confundir:** esta atualização é **documentação de gaps**, não implementação, PASS, deploy ou autorização para cobrança real.

### CURRENT — consolidação 18/11/2026 (candidatas, não produção)
- #132 fallback legado desacoplado: CI #44439235505 SUCCESS no HEAD anterior. Owner bloqueado já corrigido pelas entregas #258/#223; não reimplementar.
- P3-IRON-03 histórico e pagamentos: Command #218 inclui invoices de toda a academia vinculada, até 24 com indicação de truncamento, data da fatura e status/data de registro do pagamento; proxy valida e filtra dados sensíveis; app apresenta os fatos. Campo de próxima cobrança do provider não existe no ledger: `paidThrough` é cobertura registrada, não data confirmada de renovação. Recibo fiscal/gateway não é fabricado.
- P3-IRON-04/05 recuperação pós-reload: mesma oferta e única fatura pendente, mesmo tenant/produto/customer/gateway/valor, sob lock de assinatura; novo request id vincula a fatura original sem criar outra assinatura. Status pago ou distinto permanece bloqueado. Alteração em Command #218, a certificar.
- P3-IRON-05 ações de mudança/cancelamento: C06 do Command registra intenções administrativas `awaiting_policy` e rejeições, não autoriza execução de IRON. Não usar rota humana ou implementar política inventada. Permanecem OPEN até contrato canônico de autosserviço e política efetivamente executável. Sem confundir com webhook de cancelamento já construído.
- P3-IRON-01/02/06/07 mantêm os critérios originais. Sem nova integração antes do fechamento residual, conforme determinação do proprietário.

### CURRENT — contrato oficial de renovação e gestão (18/11/2026 BRT)
- Cakto documenta OAuth `POST /public_api/token/`, pedidos `GET /public_api/orders/{id}/`, assinaturas `GET /public_api/subscriptions/{id}/` e `next_payment_date`. Fontes: https://docs.cakto.com.br/comece-aqui/primeira-chamada ; https://docs.cakto.com.br/api-reference/orders/retrieve ; https://docs.cakto.com.br/api-reference/subscriptions/retrieve . #218 implementa readback opcional governado (read orders/read subscriptions), vinculado ao pedido original e `sck` assinado, produto/oferta/ciclo, sem expor dados privados. #277/#132 transportam/apresentam metadata de renovação; indisponível quando não confirmada. Não estima usando paidThrough.
- Portal oficial comprador https://assinatura.cakto.com.br/ (https://www.cakto.com.br/contato): gestão/cancelamento pelo comprador autenticado independentemente. UI apresenta apenas para contrato Cakto comprovado, não encaminha PII nem tokens, não muda status ao abrir; webhook/outbox continua autoridade. Cancelamento direto via API existe, mas seu contrato descreve encerramento imediato, enquanto o fluxo comercial preserva período pago; não criar mutação sem política reconciliada. Mudança de oferta não documentada como operação direta; continua OPEN. Recibo oficial continua não comprovado. A nova implementação ainda não certificada nem integrada.
