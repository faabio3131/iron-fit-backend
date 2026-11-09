# IRON Intelligence — contrato operacional de cotas e créditos comerciais (candidato)

**Estado:** implementado em PR, sujeito à CI, migrations, rollout de versões de planos e homologação Cakto. Este documento não certifica produção.

## Autoridade e limites

- IRON: autoridade dos `ProductPlanVersion`/`ProductPlanEntitlement`, memberships/RBAC, consumo, registros de execução, aprovação humana de treinos.
- FM Command: autoridade das vendas SaaS, credenciais comerciais, ofertas/valores, pedidos adicionais, checkout Cakto, pagamentos e estornos.
- Cakto: processador externo. Um callback/retorno de página **não** é crédito; somente webhook assinado reconciliado em FM Command e outbox entregue por S2S.
- Academia → aluno: domínio financeiro separado, proibido usar para comprar créditos FM.
- Ações em IA nunca são ilimitadas; quotas são consumidas somente dentro do ciclo mensal e não acumulam. A assinatura anual também recebe **cota mensal**.
- `ai.workout_monthly_max` e `ai.advisory_monthly_max`: entitlements canônicos de tipo `LIMIT`, com default seguro `0`. Um plano antigo publicado sem esses entitlements **não recebe crédito por inferência de nome de plano**.

## API IRON e segurança

- `GET /ai/quota`: JWT + role autorizada + tenant ativo; mostra quotas de WORKOUT e ADVISORY, progresso, período mensal e aviso 70/90/100%.
- `POST /ai/workout-candidates`: mantém revisão profissional. A execução reserva uma unidade por request lógico, independentemente de retry do provedor; o ledger de tentativas/estimativa financeira separado não é reescrito.
- `POST /ai/credits/checkout`: JWT OWNER/SUPER_ADMIN, `packageCode` e `requestId`. Tenant vem exclusivamente do JWT. O servidor invoca o FM Command com token S2S, sem preço informado pelo browser.
- `POST /control-plane/fmcc/ai/credits/grant` e `/revoke`: protegidos pelo guard S2S já existente (`FMCC_IRON_CONTROL_PLANE_TOKEN`), não acessíveis por JWT de tenant. `sourceInvoiceId` carrega o UUID imutável da ordem avulsa no Command. Grant não duplica, revoke não apaga trilha.
- Bancos: `AiMonthlyConsumption` e `AiCreditGrant` em Prisma/PostgreSQL. Não armazenar prompt, histórico clínico, PAN, CVV, webhook bruto nem segredo.

## Pacotes avulsos

| Código | Unidades | Preço de referência no FM Command |
| --- | ---: | ---: |
| `IRON_AI_WORKOUT_100` | 100 | R$ 19,90 |
| `IRON_AI_WORKOUT_300` | 300 | R$ 49,90 |
| `IRON_AI_WORKOUT_1000` | 1.000 | R$ 129,90 |

Valores estão fixados no código financeiro Command e nos checks do banco. Só Cakto `one_time` autorizado, sem recorrência, pode liquidar essa ordem. Pacotes adquiridos são finitos e vinculados ao ciclo atual; não é possível inventar saldo por configuração do navegador. Não aplicar limites de quantidade **após** confirmação financeira: qualquer teto comercial de compras deve bloquear **antes do checkout**.

## Fluxo de pagamento e reversão

1. Proprietário autenticado clica em pacote, IRON valida tenant/role e manda solicitação idempotente S2S ao FM Command.
2. Command verifica assinatura ativa e período pago, vínculo cliente/academia, preço, provedor Cakto em produção e oferta `one_time` exata; grava ordem avulsa `pending` e devolve URL de pagamento.
3. Somente evento de pagamento real, assinado e de preço/produto exatos, muda pedido para `paid` e cria `GRANT` no outbox **na mesma transação**.
4. Worker com lease, retry limitado e endpoint HTTPS estritamente permitido chama IRON S2S. Backend verifica assinatura/ciclo/tenant, deduplica pelo ID financeiro e registra concessão e auditoria. Reenvio não duplica.
5. Estorno/chargeback assinado muda pedido para `refunded`, cria `REVOKE` e invalida créditos ainda disponíveis. Se reembolso chegar antes da entrega do grant, o worker não ressuscita os créditos.
6. UI nunca atualiza o saldo após abrir o checkout. Somente `GET /ai/quota` retorna o estado confirmado.

## Configuração externa — NÃO preencher com credenciais fictícias

IRON backend: `FMCC_IRON_CREDITS_CHECKOUT_URL` deve apontar para URL HTTPS concreta do FM Command terminada em `/api/internal/iron/ai-credits/checkout`; `FMCC_IRON_CREDITS_CHECKOUT_TOKEN` é segredo S2S com 32+ caracteres. FM Command: configurar o mesmo token, três ofertas `one_time` oficiais em `FMCC_CAKTO_CHECKOUTS_JSON`, Cakto webhook na rota `/api/webhooks/iron/cakto/ai-credits`, `FMCC_IRON_CONTROL_PLANE_URL` e token S2S, scheduler autenticado `POST /api/internal/automation/iron/ai-credits/drain`.

**Gate comercial importante:** a proposta de quatro planos ainda está em `config/commercial/iron-four-tiers-2026.candidate.json`, não publica entitlements. O histórico imutável dos planos `PUBLISHED` não pode ser sobrescrito; preparar versões novas e transição comercial via FM Command com Launch Matrix e CI. A ausência de limites efetivos deve bloquear IA, nunca conceder "ilimitado" ou ignorar tenant.

## Testes e go-live

Reexecutar lint/typecheck/build, toda matriz backend e web, contrato S2S, Cakto HMAC/mismatch/replay, outbox/refund, concorrência e migrations isoladas. Verificar status real das PRs e resultados da CI, não confundir teste local/mock com transação Cakto. Nenhum merge/deploy até checks verdes, migração segura e verificação pós-merge. A transação com dinheiro real e oferta oficial requer configuração/homologação externas.
