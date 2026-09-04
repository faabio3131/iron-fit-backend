# IRON — AGG4 Wellhub Adapter

Status: **CANDIDATE INTERNO — integração externa depende de homologação Wellhub**

Baseline: `main @ 88082c1daee3e75760128c51c5859c30ed33b9c0`

Branch: `stabilization/iron-agg4-wellhub-adapter`

## Objetivo

Implementar a fronteira provider-specific do Wellhub sobre o domínio canônico AGG1–AGG3 sem inventar endpoints, TTLs, assinatura de webhook, retries, rate limits, sandbox ou credenciais que não estejam confirmados pelo contrato técnico vigente.

AGG0 confirmou publicamente, em nível de produto, que Fitness Partners possuem integração, Access Control API, Booking API e Integration Setup API. AGG0 também registrou que o contrato técnico final de Access Control, assinatura de webhook, event IDs, TTL, retries, rate limits e ambiente de homologação exigem documentação/credenciais de parceiro. O AGG4 respeita essa fronteira.

## Arquitetura do adapter

O código introduz uma porta de transporte explícita:

`WELLHUB_PARTNER_TRANSPORT`

A porta expõe apenas uma operação canônica de obtenção da elegibilidade corrente:

`fetchCurrentEligibility(...)`

Nenhuma URL, rota Wellhub, header, segredo ou formato privado de payload é hardcoded. A implementação concreta desse transporte somente poderá ser instalada após receber e validar a documentação técnica oficial aplicável ao tenant/país.

`WellhubAdapterService.refreshEligibilityAndAuthorize(...)` orquestra:

1. tenant derivado internamente;
2. membro obrigatoriamente pertencente a uma `AggregatorProviderConnection` com `providerCode = WELLHUB` no mesmo tenant;
3. idempotência por decisão já existente `(memberId, externalVisitId)` antes de chamar o provider;
4. conexão do provider obrigatoriamente `ACTIVE`;
5. pré-condições mínimas de homologação local: `externalLocationId`, `contractVersion` e `lastVerifiedAt` presentes;
6. transporte parceiro instalado;
7. consulta de elegibilidade corrente via porta externa;
8. normalização fail-closed da evidência;
9. persistência pelo `AggregatorEligibilityService` canônico;
10. decisão final pelo `AggregatorVisitAuthorizationService` do AGG3.

O adapter não duplica o motor de autorização. Wellhub apenas fornece evidência; o IRON mantém a decisão determinística.

## Fail closed

O adapter nunca reutiliza silêncio ou indisponibilidade do provider como autorização.

Se a conexão não está ativa, não há chamada externa e o AGG3 persiste a negação correspondente.

Se faltam dados mínimos de homologação, o adapter grava evidência `UNKNOWN` com `WELLHUB_NOT_HOMOLOGATED` antes da decisão.

Se o transporte não está instalado ou falha, grava `UNKNOWN` com `WELLHUB_TRANSPORT_UNAVAILABLE` antes da decisão.

Se Wellhub for normalizado como `ELIGIBLE` sem `validUntil` válido, o adapter não inventa TTL: converte para `UNKNOWN` com `WELLHUB_ELIGIBLE_WITHOUT_VALID_EXPIRY`.

Timestamp futuro inválido é convertido para `UNKNOWN` com `WELLHUB_INVALID_PROVIDER_TIMESTAMP`.

`UNKNOWN` continua nunca equivalente a `ELIGIBLE`.

## Identidade e membership

`externalMemberId` é usado apenas para consultar o provider pela porta homologada. Ele não autoriza visita por si só.

Quando o transporte retorna `externalMembershipId`, o adapter tenta resolver um `AggregatorMembership` já persistido no mesmo membro. Ausência de vínculo local não causa criação automática nem associação inferida.

## Segurança e dados

O AGG4 não lê nem persiste credenciais em `AggregatorProviderConnection.configuration`. Nenhum segredo é registrado em logs, AuditLog ou objetos do domínio.

O retorno do transporte deve ser normalizado para os campos canônicos mínimos; payload bruto do provider não é armazenado.

Tenant é resolvido antes de qualquer chamada externa. Gym A nunca utiliza conexão/membro da Gym B.

## O que NÃO foi ativado sem contrato técnico

Este bloco deliberadamente não implementa:

- URLs/endpoints reais do Wellhub;
- autenticação/headers/credential exchange;
- webhook inbound de check-in;
- assinatura/verificação de webhook;
- confirmação outbound de check-in;
- regras de retry/rate limit;
- TTL de visita inferido;
- Booking API;
- Integration Setup API;
- AccessEvent/catraca;
- settlement/payout API.

Esses elementos só podem ser adicionados quando houver evidência oficial e, quando pertencentes a blocos posteriores, somente no bloco canônico correspondente.

## Migration

Nenhuma migration nova é necessária. O adapter usa exclusivamente `AggregatorProviderConnection`, `AggregatorMember`, `AggregatorMembership`, `AggregatorEligibilityCheck` e `AggregatorVisitAuthorization` já criados no AGG1.

## Homologação externa pendente

Para transformar a porta em transporte Wellhub real serão necessários, conforme AGG0:

- contrato/anexo técnico vigente de Fitness Partner para o país/tenant aplicável;
- credenciais e ownership/rotação/revogação;
- especificação vigente do Access Control API;
- mecanismo oficial de autenticação e, se aplicável, assinatura de eventos/webhooks;
- event/replay/idempotency semantics oficiais;
- TTL/janelas de check-in oficiais;
- rate limits/retries;
- ambiente e critérios de homologação/go-live.

Até esses itens existirem, o código interno permanece seguro e testável, mas **não deve ser descrito como integração Wellhub live/homologada**.
