# AGENTES.md — IRON FIT CORE | CRONOGRAMA EXECUTÁVEL DE FECHAMENTO INTERNO
**Baseline:** 09/11/2026 · **Estado:** EM EXECUÇÃO — NÃO GO-LIVE. **Objetivo:** IRON FIT CORE V1.0.0 — GO-LIVE CERTIFIED.
Este documento é um DELTA dos AGENTS.md e dos Prompts/Cronogramas Mestres vigentes, não os substitui. Não construir demo, sistema paralelo, endpoints fictícios, autenticação/billing/tenant duplicados. CURRENT comprovado prevalece sobre documentação histórica.

## CURRENT comprovado
- Backend `faabio3131/iron-fit-backend` main `c0bbcd4e`, CI #42274200239 SUCCESS; app Web/mobile `faabio3131/iron-fit-app` main `8204c7a1`, CI #42267643474 SUCCESS.
- Contabo: Web e API HTTP 200, PostgreSQL readiness OK, 55 migrations aplicadas. Em 09/11, backend `959b2ea`, app `7a4d5f6`; árvores Git main/production equivalentes, commits com históricos diferentes. Deploy `/opt/fm/ironfit/deploy.sh` usa branches production e exige fast-forward, PROIBIDO forçar.
- Ambiente da Contabo: `HOMOLOG`, `SAAS_BILLING_PROVIDER=INTERNAL_SANDBOX`, e-mail transacional desabilitado. `fmadmin` é o usuário de acesso SSH existente; nunca copiar credenciais para repo.
- Billing SaaS de academia é autoridade FM Command (`faabio3131/fm-command-v2`), distinto de financeiro academia→aluno e de assinaturas do próprio FM Command. FM Command Cakto PR #56 DRAFT, CI #42570593789 e PostgreSQL #42570593935 SUCCESS na revisão `38a4188e` (NÃO PUBLICADO). Site FM `faabio3131/fm-site-novo` PR #19 DRAFT, CI #42571006545 SUCCESS `1fae292` (NÃO PUBLICADO). Backend #211 vídeos candidatos aberta.
- Cakto: webhooks assinados HMAC-SHA256 timestamp + corpo bruto conforme documentação oficial; sem conta, ofertas, URLs e secret reais; CPF do titular não elimina automaticamente obrigação fiscal de vendedor.

## Execução autônoma por WP
**AUDITAR → IMPLEMENTAR → TESTAR → CORRIGIR → RETESTAR → AUDITAR DIFF → PR → CI → MERGE QUANDO GATE PERMITIR → PÓS-MERGE → PRÓXIMO WP.**
Registrar macro/WP, repo, branch, HEAD, PR, CI, testes efetivamente executados, deploy, ambiente, bloqueio e próxima ação. Falha corrigível: corrigir e retestar. Sem PASS sem prova.

### Ordem obrigatória e critérios de aceite
| WP | Domínio canônico e trabalho interno obrigatório | Gate técnico |
|---|---|---|
| IF-P0-01 | **Reconciliação** de billing IRON no FM Command: invoice, customer, tenant, produto, plano, gateway, subscription, outbox e endpoint S2S IRON. Identificar colisões entre o ledger de produto e o serviço de assinaturas do próprio Command | contrato e fonte de verdade reproduzíveis + testes cross-domain |
| IF-P0-02 | **Cakto checkout**: somente fatura previamente registrada, oferta oficial associada a plano e valor, checkout com callback opaco, sem URL genérica que não identifica cliente; configurar URLs/IDs via Vault/env | testes de checkout, plano errado, tenant errado, múltiplos compradores e URL maliciosa |
| IF-P0-03 | **Cakto webhook**: HMAC raw body/timestamp, janela, dedupe, eventos compra/renovação/atraso/cancelamento/estorno/chargeback, valores, plano, gateway e vínculo imutável; retries/lease/DLQ, sem PII ou PAN | testes fraude, replay, out-of-order, idempotência, concorrência e rollback da transação |
| IF-P0-04 | **S2S licenças**: outbox Command→IRON com entrega HTTP autenticada, expectedSubscriptionId/gymId do vínculo persistido, retries/DLQ e certificação ACTIVE/SUSPENDED/CANCELED | e2e real PostgreSQL+HTTP, pagamento→licença e refund→suspensão; sem dependência de credencial live nos testes internos |
| IF-P0-05 | **Cliente 1**: visitante→trial→academia/OWNER→login→onboarding→checkout→pagamento→entitlement, recuperação/ativação/suspensão, multiacademia | navegador+API+PostgreSQL, RBAC e negative paths |
| IF-P0-06 | **Sites reais** FM e IRON: preço/plano alinhado às ofertas Cakto, checkout vinculado à fatura, botões navegáveis, retorno de compra, textos legais somente confirmados | teste de CTA real, sem links fictícios, sem ativação por redirect |
| IF-P0-07 | **Comunicação**: convite, login/reset, verificação e alertas; adapters transport reais configuráveis, fila durável, retries/backoff e DLQ; dados sensíveis mascarados | teste de envio controlado, worker e recovery, configuração PROD fail-closed |
| IF-P1-01 | **Academia E2E**: recepção, matrícula, alunos, equipe, treino DRAFT→revisão→ativo, equipamentos, avaliação, agenda/check-in/QR, financeiro academia→aluno e caixa com RBAC granular | teste ponta a ponta HTTP/Postgres/browser; nenhum fluxo de botão morto |
| IF-P1-02 | **Integrações**: Access Center Control iD/Topdata/Henry/DIMEP, Evolution, Intelligence governada, Creator, Aggregator; classificar produção/sandbox/blocker sem simular hardware | contratos testados; integrações externas fora de live até homologação |
| IF-P1-03 | **Visual Premium** no produto existente, Web/mobile, responsividade, acessibilidade, erros/loading/offline, RBAC/entitlements; vídeos candidatos #211 só publicados após revisão | regressão real + CI. Macro O O22 preview/O23 aprovação visual explícita/O24 merge, se gate ainda aplicável |
| IF-Q-01 | **Security & Performance**: IDOR/tenant, role/step-up, MFA, tokens, webhooks, Vault, LGPD, secrets, DAST, carga controlada, disponibilidade | zero stop-ship crítico/alto, p50/p95/p99 e evidências de scanner |
| IF-R-01 | **Production readiness**: Vault/SMTP/Cakto prontos para injetar segredos externos, banco/migrations, backup com restore, rollback, observabilidade, alerts, operações, LGPD, DNS/TLS | matriz GO/NO-GO honesta, blockers externos isolados |
| IF-S-01 | **Release v1.0.0**: freeze SHAs, tag, changelog, builds, PRs e CI verdes, pacote de release/rollback | release canônico verificável |
| IF-T-01 | **Go-live**: preflight, cutover controlado, smoke do cliente, S2S/billing, observabilidade, rollback standby, certificação final | GO-LIVE CERTIFIED somente com evidência real; sem credenciais externas, classificar INTERNAL READY/EXTERNAL BLOCKER |

## Gates imutáveis
O Visual Premium só pode receber merge final após aprovação visual explícita para a candidata em avaliação. A IA é advisory; treino requer revisão profissional. Todo financeiro é backend-authoritative; acesso por role+permission+tenant+entitlement+step-up. Cakto jamais autoriza licença por e-mail/CPF, redirect, link genérico ou payload sem assinatura, valor e fatura compatíveis. Não usar sandbox como produção. Não marcar hardware/provider como homologado sem evidência. STOP-SHIP: secrets/cross-tenant leak, privilege escalation, PAN/CVV, cobrança ou licença incorreta, CI/build/E2E crítico vermelho, migração quebrada, falso deploy.

## Dependências externas (não interromper a construção interna)
Cakto: validação da conta CPF/KYC, ofertas e URLs reais, secret webhook em cofre, primeira transação autorizada, confirmação fiscal/tributária. Hardware: SDK/equipamento presencial. SMTP: configuração de domínio/SPF/DKIM/DMARC. Fiscal/providers: credenciais oficiais/assinaturas/homologações. Não rebaixar o escopo interno por indisponibilidade desses dados.

## CHECKPOINT — atualizado 09/11/2026
**Macro/WP:** P — IF-P0-01, iniciado. **Branch backend:** `chore/iron-internal-closure-agentes-20261109`. **FM Command:** PR #56 DRAFT; **Site:** PR #19 DRAFT. **Deploy:** HOMOLOG, sem Cakto publicada. **Gate:** CI main backend/app verde; CI candidata Command/site verde, mas P/Q/R/S/T ainda não certificados. **Próxima ação:** ler schema e integração FM Command↔IRON, implementar outbox/S2S real e testes adversariais, certificar CI e prosseguir em sequência.
