# IRON — AGG0 Provider Discovery, Contracts & Capability Map

Status: **CANDIDATE — IRON-AGG0**

Data da pesquisa: **04/09/2026**

Baseline canônica: `main @ e5f61f0e8b12bcc04630d817e253a36f049cbe20`

## 1. Escopo e limite do bloco

IRON-AGG0 é exclusivamente discovery, contratos e capability map dos providers. Este bloco **não cria modelos Prisma, migrations, adapters, endpoints de produção ou lógica de autorização**; isso pertence aos blocos AGG1+.

A arquitetura oficial do IRON permanece soberana:

- contrato válido identifica uma relação jurídica;
- elegibilidade/autorização válida da visita atual autoriza a visita;
- confirmação financeira valida receita;
- cadastro ou autorização histórica nunca autoriza visita futura por si só;
- `UNKNOWN` nunca equivale a `ELIGIBLE`;
- provider member ID é identificador externo, não autorização;
- provider externo nunca escreve diretamente nos domínios internos; passa por adapter/webhook/API validado;
- acesso físico recebe uma decisão contextual de autorização, não apenas um identificador;
- IA fica fora do caminho crítico de autorização da catraca;
- check-in externo, evento físico e settlement devem ser reconciliáveis.

## 2. Método de classificação da descoberta

Toda capability é classificada em uma destas categorias:

- **PUBLICLY_CONFIRMED** — confirmada em documentação/página pública oficial do provider.
- **PARTNER_ACCESS_REQUIRED** — o provider confirma a integração, mas detalhes técnicos/contratuais completos dependem de credencial, termo, portal ou homologação de parceiro.
- **NOT_PUBLICLY_CONFIRMED** — não foi encontrada confirmação pública suficiente; o IRON não deve inventar endpoint, payload, SLA ou semântica.
- **NOT_APPLICABLE** — capability não faz parte do fluxo conhecido daquele provider.

Regra: ausência de documentação pública é tratada como lacuna a resolver por contrato/homologação, nunca como permissão para inferir comportamento.

## 3. Taxonomia canônica de capabilities

O Future Provider Contract do IRON deverá conseguir representar, sem acoplar o Core a nomes de empresas:

| Capability | Significado canônico |
|---|---|
| `PARTNER_CONNECTION` | Credenciais/configuração por provider e unidade/tenant. |
| `MEMBER_IDENTITY` | Identificador externo e dados mínimos de identidade/vínculo. |
| `CURRENT_VISIT_ELIGIBILITY` | Confirmação de que a visita atual pode ser autorizada; inclui timestamp, escopo e expiração quando fornecidos. |
| `CHECKIN_EVENT_INBOUND` | Provider notifica check-in/solicitação de visita ao IRON. |
| `CHECKIN_CONFIRMATION_OUTBOUND` | IRON confirma/valida ao provider uma visita recebida. |
| `BOOKING_INVENTORY_SYNC` | Publicação/sincronização de aulas, horários, capacidade e disponibilidade. |
| `BOOKING_RESERVATION_SYNC` | Reserva/cancelamento/alteração sincronizados. |
| `ATTENDANCE_SYNC` | Presença/no-show/cancelamento vinculável à reserva/visita. |
| `LOCATION_SYNC` | Unidades/locais e metadados operacionais. |
| `PLAN_OR_PRODUCT_SCOPE` | Plano/modalidade elegível para a unidade/serviço. |
| `SETTLEMENT_VISIBILITY` | Informação de repasse/receita prevista ou confirmada para reconciliação. |
| `SETTLEMENT_API` | API estruturada para obter itens de settlement; somente TRUE quando oficialmente confirmada. |
| `WEBHOOK_MANAGEMENT` | Cadastro/rotação/remoção e verificação de destino de webhook. |
| `REPLAY_IDEMPOTENCY_SIGNAL` | ID de evento/idempotency key ou outro identificador oficial para deduplicação. |
| `SANDBOX_OR_TEST_ENV` | Ambiente formal de testes ou mecanismo oficial equivalente. |
| `RATE_LIMIT_CONTRACT` | Limites documentados e tratamento de throttling. |
| `PROVIDER_HEALTH_SIGNAL` | Sinal oficial de indisponibilidade/erro que permita diferenciar `UNKNOWN` de negação. |

Nenhuma capability opcional pode ser presumida pelo Core. O adapter declarará capabilities suportadas e o Core deve falhar de forma segura quando uma capability obrigatória ao fluxo não estiver disponível.

## 4. Capability Map — visão executiva

| Capability | Wellhub | TotalPass | ClassPass | Future Provider |
|---|---|---|---|---|
| Partner/CMS integration | PUBLICLY_CONFIRMED | PUBLICLY_CONFIRMED | PUBLICLY_CONFIRMED | contrato obrigatório |
| Access/check-in integration | PUBLICLY_CONFIRMED | PUBLICLY_CONFIRMED | NOT_PUBLICLY_CONFIRMED como fluxo de catraca | capability opcional |
| Inbound check-in webhook | produto/API pública indica integração de Access Control; detalhes devem ser homologados | PUBLICLY_CONFIRMED | NOT_PUBLICLY_CONFIRMED para catraca | capability opcional |
| Check-in confirmation | Access Control API PUBLICLY_CONFIRMED; contrato técnico final a validar | PUBLICLY_CONFIRMED | NOT_PUBLICLY_CONFIRMED | capability opcional |
| Booking/schedule sync | PUBLICLY_CONFIRMED | PUBLICLY_CONFIRMED | PUBLICLY_CONFIRMED | capability opcional |
| Reservations | PUBLICLY_CONFIRMED | PUBLICLY_CONFIRMED | PUBLICLY_CONFIRMED | capability opcional |
| Capacity/inventory | Booking integration PUBLICLY_CONFIRMED; campos exatos a homologar | PUBLICLY_CONFIRMED | PUBLICLY_CONFIRMED | capability opcional |
| Attendance | visita/check-in confirmável PUBLICLY_CONFIRMED | check-in validado PUBLICLY_CONFIRMED | PUBLICLY_CONFIRMED na Inventory API | capability opcional |
| Partner payout visibility | PUBLICLY_CONFIRMED via partner/payment dashboard | PUBLICLY_CONFIRMED via Portal de Academias | PUBLICLY_CONFIRMED via Partner Dashboard | capability opcional |
| Structured settlement API | NOT_PUBLICLY_CONFIRMED | NOT_PUBLICLY_CONFIRMED | NOT_PUBLICLY_CONFIRMED | capability opcional |
| Formal sandbox | documentação pública de fitness-partner sandbox não confirmada nesta descoberta | **não existe sandbox separado**; teste oficial ocorre em produção com usuário de teste | NOT_PUBLICLY_CONFIRMED | capability opcional |
| Contract/partner onboarding required | PUBLICLY_CONFIRMED | PUBLICLY_CONFIRMED e pré-requisito para docs/keys | PUBLICLY_CONFIRMED | obrigatório |

## 5. Wellhub — descoberta confirmada

### 5.1 Evidência pública

As páginas oficiais de parceiros confirmam que academias podem integrar seus sistemas de gestão/booking, receber pagamento mensal por visita/check-in e acompanhar depósitos no dashboard de pagamentos. O Developer Portal público lista, para **Fitness Partners**, os produtos `Booking API`, `Access Control API` e `Integration Setup API`.

Classificação:

- `PARTNER_CONNECTION`: **PUBLICLY_CONFIRMED**.
- `CURRENT_VISIT_ELIGIBILITY`/validação de visita por Access Control: **PUBLICLY_CONFIRMED em nível de produto**, com contrato técnico final sujeito à homologação do parceiro.
- `CHECKIN_CONFIRMATION_OUTBOUND`: **PUBLICLY_CONFIRMED em nível de produto**.
- `BOOKING_INVENTORY_SYNC`: **PUBLICLY_CONFIRMED**.
- `BOOKING_RESERVATION_SYNC`: **PUBLICLY_CONFIRMED**.
- `SETTLEMENT_VISIBILITY`: **PUBLICLY_CONFIRMED via Partner Portal/payment dashboard**.
- `SETTLEMENT_API`: **NOT_PUBLICLY_CONFIRMED** nesta descoberta.
- detalhes normativos de assinatura de webhook, event IDs, TTL de check-in, rate limits, retries e sandbox para Fitness Partners: **PARTNER_ACCESS_REQUIRED / NOT_PUBLICLY_CONFIRMED** até homologação.

### 5.2 Implicação para o IRON

O adapter Wellhub de AGG4 não poderá ser implementado com endpoints, TTLs, assinatura de webhook ou regras de retry inferidos. AGG0 registra como requisito de homologação obter o contrato técnico vigente do Access Control API, Booking API e Integration Setup API para o tenant/país aplicável.

O payout público confirma a necessidade de manter settlement/reconciliation separados da autorização física: uma visita validada participa do cálculo financeiro, mas o contrato comercial pode conter teto, desconto e regras específicas por parceria/localidade.

## 6. TotalPass — descoberta confirmada

### 6.1 APIs públicas e fluxo de integração

A Central de Ajuda e o portal de desenvolvedores da TotalPass confirmam duas integrações principais para ERP:

1. **API de Validação de Check-in**
   - ERP recebe webhook em tempo real quando o usuário solicita check-in no app;
   - o payload inclui um link/endpoint de validação;
   - o ERP confirma a visita por `POST` nesse endpoint;
   - a validação expira após **90 minutos**;
   - o fluxo pode acionar catraca/biometria/reconhecimento facial do ERP;
   - conflito com validação manual pode resultar em HTTP 422 porque o check-in já não está disponível.

2. **API de Booking**
   - espelha grade de aulas;
   - gerencia reservas e cancelamentos;
   - sincroniza vagas/slots para evitar overbooking;
   - suporta seat maps em cenários aplicáveis.

Credenciais e onboarding:

- integração exige **Termo de Adesão**;
- após assinatura, TotalPass fornece documentação técnica e `partner_api_key` + `place_api_key` de teste;
- `partner_api_key` é confidencial e não deve ser solicitada ao cliente final;
- a unidade gera/fornece `place_api_key` no Portal após homologação;
- tokens de API descritos para Check-in/Booking expiram em 24h;
- **não existe sandbox separado**: desenvolvimento/homologação usa ambiente de produção com usuário oficial de testes criado pela TotalPass.

Classificação:

- `PARTNER_CONNECTION`: **PUBLICLY_CONFIRMED**.
- `CHECKIN_EVENT_INBOUND`: **PUBLICLY_CONFIRMED**.
- `CHECKIN_CONFIRMATION_OUTBOUND`: **PUBLICLY_CONFIRMED**.
- `BOOKING_INVENTORY_SYNC`: **PUBLICLY_CONFIRMED**.
- `BOOKING_RESERVATION_SYNC`: **PUBLICLY_CONFIRMED**.
- `SETTLEMENT_VISIBILITY`: **PUBLICLY_CONFIRMED via Portal de Academias**.
- `SETTLEMENT_API`: **NOT_PUBLICLY_CONFIRMED**.
- `SANDBOX_OR_TEST_ENV`: **PUBLICLY_CONFIRMED = sem sandbox separado; produção controlada + usuário de teste**.
- assinatura/replay/idempotency key normativa dos webhooks: detalhes completos devem ser confirmados na documentação entregue após o Termo de Adesão.

### 6.2 Implicação para o IRON

O adapter TotalPass de AGG5 deverá isolar `partner_api_key` como segredo do IRON, tratar `place_api_key` por unidade e nunca transformar a janela de 90 minutos em autorização histórica. Receber um webhook não é igual a liberar catraca; a autorização física depende da validação determinística da visita corrente e das regras internas do IRON.

A inexistência de sandbox exige uma estratégia de homologação segura separada de dados reais de academias clientes, com tenant/unidade de teste explícitos e nenhuma reutilização acidental de credenciais de produção de cliente.

## 7. ClassPass — descoberta confirmada

### 7.1 Inventory/Booking

A documentação oficial de developers descreve a **ClassPass Inventory API** como interface para obter schedules de terceiros e executar transações sobre esses schedules, incluindo **capacity, reservations e attendance**. As páginas de parceiros confirmam integração com mais de 80/100 sistemas de booking, sincronização automática da agenda, proteção contra double booking e gestão de reservas.

Pagamentos:

- parceiros recebem por reservas conforme acordo;
- o Partner Dashboard apresenta reservas concluídas, earnings por reserva, resumos mensais e histórico de payouts;
- a remuneração ocorre normalmente por depósito direto via Tipalti; periodicidade pode variar conforme acordo/mercado.

Classificação:

- `PARTNER_CONNECTION`: **PUBLICLY_CONFIRMED**.
- `BOOKING_INVENTORY_SYNC`: **PUBLICLY_CONFIRMED**.
- `BOOKING_RESERVATION_SYNC`: **PUBLICLY_CONFIRMED**.
- `ATTENDANCE_SYNC`: **PUBLICLY_CONFIRMED** no escopo da Inventory API.
- `SETTLEMENT_VISIBILITY`: **PUBLICLY_CONFIRMED via Partner Dashboard**.
- integração específica de catraca/access-control equivalente a Wellhub/TotalPass: **NOT_PUBLICLY_CONFIRMED** nesta descoberta.
- `SETTLEMENT_API`, webhook signing, idempotency semantics, rate limits e sandbox: **NOT_PUBLICLY_CONFIRMED / PARTNER_ACCESS_REQUIRED** até onboarding técnico.

### 7.2 Implicação para o IRON

ClassPass deve entrar como provider capability-driven, sem forçar `Access Control` se o contrato real do provider for orientado a booking/inventory/attendance. O Core não pode exigir que todos os providers tenham a mesma topologia operacional.

## 8. Future Provider Contract — requisitos mínimos descobertos

AGG1 poderá modelar um domínio canônico provider-neutral, mas o adapter futuro somente poderá declarar uma capability como ativa quando houver evidência oficial/configuração válida.

Todo provider deverá fornecer ou permitir registrar, conforme capabilities aplicáveis:

- provider code e versão do adapter/contrato;
- external location/place ID;
- external member/user ID sem tratá-lo como autorização;
- external visit/check-in/reservation ID;
- timestamps oficiais e timezone;
- status externo original + mapeamento canônico;
- evidência da autorização/validação da visita;
- event ID/idempotency key quando fornecido;
- origem (`API`, `WEBHOOK`, `PORTAL_IMPORT`, `MANUAL_EVIDENCE`) com proveniência;
- política oficial de expiração/TTL quando existir;
- referências de settlement/payout quando disponibilizadas;
- capacidade de diferenciar erro técnico/indisponibilidade (`UNKNOWN`) de resposta negativa (`INELIGIBLE`/`DENIED`).

## 9. Requisitos contratuais para onboarding de provider

Antes de ativar um adapter em produção, o pacote de onboarding deve registrar:

- entidade legal contratante e país/jurisdição;
- unidades/tenants cobertos;
- versão/data do contrato e anexos técnicos;
- regras de check-in/visita, limites, janelas e exceções;
- modalidades/planos cobertos;
- regras de booking/cancelamento/no-show quando aplicáveis;
- fórmula/fonte de repasse, periodicidade, caps/descontos quando aplicáveis;
- prazo e evidência exigida para disputa;
- DPA/LGPD, finalidade, retenção e compartilhamento de dados;
- contatos de suporte/homologação/escalonamento;
- credenciais, rotação, revogação e ownership do segredo;
- webhook security, replay/idempotency, retries, rate limits e IP/domain requirements quando oficialmente fornecidos;
- ambiente de teste/homologação e critérios de go-live.

Informação comercial sensível de contrato não deve ser hardcoded no adapter; deve permanecer governada em configuração/Agreement Vault conforme os blocos posteriores.

## 10. Segurança e LGPD — invariantes AGG0

- Nunca usar `externalMemberId`, CPF, e-mail ou nome como prova suficiente de autorização da visita.
- Credenciais de provider são segredos; não registrar plaintext em logs, audit ou payloads de negócio.
- Webhooks devem ser autenticados/verificados conforme mecanismo oficial do provider; quando esse mecanismo ainda não estiver documentado, a integração permanece não homologada.
- Eventos recebidos devem ter proteção contra replay/duplicidade por identificador oficial ou estratégia de idempotência governada.
- Dados pessoais devem ser minimizados conforme finalidade contratual e LGPD.
- Comunicação comercial com usuário de agregador depende de finalidade, consentimento e regras contratuais do provider.
- Acesso manual/provisório exige permissão específica, auditoria, limite e revalidação futura; isso será implementado somente em AGG6.

## 11. Semântica obrigatória de falha

O Core deverá preservar a distinção:

- `ELIGIBLE/CONFIRMED`: provider confirmou a visita conforme contrato vigente.
- `INELIGIBLE/DENIED`: provider respondeu negativamente.
- `UNKNOWN`: não foi possível obter confirmação confiável por timeout, indisponibilidade, erro não classificável ou ausência de capability.

`UNKNOWN` **NUNCA** pode ser convertido automaticamente em `ELIGIBLE`. Qualquer exceção futura será `PROVISIONAL`, governada em AGG6, auditada e sujeita a revalidação.

## 12. Gaps externos e pendências de homologação

### Wellhub

Necessário obter no onboarding oficial vigente para o mercado-alvo:

- contrato técnico completo Access Control/Booking/Integration Setup;
- autenticação/rotação de credenciais específica de Fitness Partner;
- assinatura/autenticidade de webhook;
- IDs oficiais e regras de idempotência/replay;
- rate limits/retry/backoff;
- ambientes de homologação;
- fonte estruturada de settlement, se houver API/export disponível por contrato.

### TotalPass

Necessário formalizar Termo de Adesão e obter documentação/credenciais oficiais para homologação. Confirmar na documentação entregue:

- assinatura/verificação de webhook;
- event IDs/idempotência/replay;
- rate limits/retry/backoff;
- formato definitivo de payloads;
- meio estruturado de settlement/export financeiro, se disponibilizado.

### ClassPass

Necessário onboarding técnico/contratual para confirmar:

- autenticação e credenciais da Inventory API para o IRON;
- webhooks/polling e garantias de entrega;
- idempotência/replay e rate limits;
- sandbox/homologação;
- settlement/export/API disponível para reconciliação;
- se existe capability formal de access-control/check-in físico para o modelo de academia alvo.

Essas lacunas são **externas e explicitamente conhecidas**. Elas não autorizam implementar detalhes inventados.

## 13. Decisão de gate para AGG1

A descoberta pública é suficiente para definir um **domínio canônico provider-neutral e capability-driven** em AGG1 sem codificar particularidades privadas de nenhum provider. Portanto, as pendências de contrato/credencial são classificadas como **pendências externas de homologação dos adapters**, especialmente AGG4/AGG5, e não exigem inventar endpoints para avançar ao domínio canônico.

AGG1 deve modelar capabilities e proveniência de forma que um detalhe privado posterior seja configuração/adapter, não alteração estrutural do Core.

## 14. Fontes oficiais consultadas

### Wellhub

- Wellhub for Partners — https://wellhub.com/en-us/partners/
- Wellhub para parceiros — https://wellhub.com/pt-br/partners/
- Integrate with Wellhub — https://wellhub.com/en-us/partners/integrate-with-wellhub/
- Wellhub Developers — Fitness Partners / Access Control API / Booking API / Integration Setup API — https://developers.wellhub.com/product/access-control-api/1.0/endpoints

### TotalPass

- O que são as APIs da TotalPass e o que eu consigo fazer com elas? — https://ajuda.totalpass.com.br/hc/pt-br/articles/48940081973275
- Quais são as etapas para se integrar à TotalPass? — https://ajuda.totalpass.com.br/hc/pt-br/articles/48941417163931
- API: Validação de Check-in — https://ajuda.totalpass.com.br/hc/pt-br/articles/48920022036635
- API: Booking — https://ajuda.totalpass.com.br/hc/pt-br/articles/48923933171483
- Portal de Academias — https://totalpass.com/br/academias-estudios/
- Developer reference — https://dev.totalpass.com/

### ClassPass

- ClassPass Developers / Inventory API — https://developers.classpass.com/specInfo
- Booking integrations — https://classpass.com/partners/pt-br/classpass-booking-integrations
- How it works for businesses — https://classpass.com/partners/pt-br/how-it-works
- Payouts, Pricing and Policies — https://classpass.com/partners/blog/classpass-payouts-pricing-policies-rates

## 15. Critérios de aceite AGG0

- capability map provider-neutral documentado;
- Wellhub, TotalPass e ClassPass classificados sem inventar capacidades;
- detalhes privados/desconhecidos explicitamente marcados;
- `UNKNOWN != ELIGIBLE` preservado;
- external member ID nunca é autorização;
- provider externo sempre isolado por adapter;
- check-in, evento físico e settlement permanecem conceitos separados e reconciliáveis;
- IA fora do caminho crítico;
- pendências contratuais externas registradas;
- nenhuma migration/schema/adapter de AGG1 misturado neste bloco.
