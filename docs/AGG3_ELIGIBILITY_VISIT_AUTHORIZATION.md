# IRON — AGG3 Eligibility Engine + Visit Authorization Engine

Status: **CANDIDATE — aguardando gates**

Baseline: `main @ d1f73d87a252061decb6a1c60a1c827b702ab43b`

Branch: `stabilization/iron-agg3-eligibility-visit-authorization`

## Objetivo

Implementar o núcleo provider-neutral que transforma evidência de elegibilidade em um estado determinístico e, separadamente, decide uma autorização de visita. O AGG3 não chama APIs de Wellhub/TotalPass/ClassPass, não executa catraca, não cria acesso provisório e não faz settlement.

## Princípios obrigatórios

- `UNKNOWN` nunca equivale a `ELIGIBLE`.
- Membership histórico não autoriza visita.
- Acordo assinado não autoriza visita sozinho.
- A autorização exige conexão ativa, acordo atual `SIGNED` e evidência atual efetivamente `ELIGIBLE`.
- Evidência `ELIGIBLE` sem expiração ou já expirada é convertida para `UNKNOWN` pelo engine.
- Evidência com timestamp futuro além da tolerância controlada é tratada como `UNKNOWN`.
- Tenant é derivado da identidade autenticada; Gym A não consulta ou autoriza membro de Gym B.
- A decisão de autorização é persistida separadamente do evento físico de acesso.
- Nenhum caminho deste bloco grava `AccessEvent`, `AggregatorAccessEventLink`, settlement ou decisão provisória.

## Eligibility Engine

`AggregatorEligibilityService` oferece duas responsabilidades provider-neutral:

1. `recordProviderEvidence(...)`: entrada interna para adapters futuros registrarem evidência normalizada do provider.
2. `findCurrent(...)`: avaliação do estado efetivo atual para um membro dentro do tenant ativo.

A gravação de evidência:

- valida o membro dentro da academia ativa;
- valida o membership opcional dentro do mesmo membro;
- exige fonte de evidência;
- exige `validUntil > verifiedAt` quando o provider afirma `ELIGIBLE`;
- limita evidência com clock futuro;
- é idempotente por `(memberId, externalCheckId)` quando o provider fornece ID externo;
- detecta conflito quando o mesmo ID externo chega com evidência diferente;
- roda em transação `Serializable` com retry controlado para conflitos concorrentes;
- registra `AGGREGATOR_ELIGIBILITY_CHECK_RECORDED` no AuditLog na mesma transação.

O endpoint público deste bloco é somente leitura:

`GET /api/v1/aggregator/eligibility/member/:memberId/current`

A escrita de evidência não é exposta diretamente a clientes. AGG4/AGG5 serão responsáveis por adapters e contratos externos.

## Visit Authorization Engine

`POST /api/v1/aggregator/visits/authorize`

Entrada pública mínima:

- `memberId`
- `externalVisitId`

O cliente não informa `gymId` nem `source`. O tenant é derivado do contexto autenticado e a proveniência operacional é definida internamente pelo IRON.

Fluxo determinístico:

1. localizar o membro exclusivamente no tenant ativo;
2. retornar decisão existente se `(memberId, externalVisitId)` já estiver persistido;
3. verificar que a conexão do provider está `ACTIVE`;
4. localizar acordo atual `SIGNED`;
5. localizar a evidência de elegibilidade mais recente;
6. converter evidência expirada/incompleta de `ELIGIBLE` para `UNKNOWN`;
7. persistir `CONFIRMED` somente se todos os requisitos forem satisfeitos;
8. caso contrário persistir `DENIED` com razão canônica;
9. auditar a decisão atomicamente.

Razões canônicas de negação implementadas neste bloco:

- `PROVIDER_CONNECTION_NOT_ACTIVE`
- `AGREEMENT_NOT_SIGNED`
- `ELIGIBILITY_UNKNOWN`
- `ELIGIBILITY_INELIGIBLE`

Quando confirmada, a autorização herda como limite de validade o `validUntil` da evidência de elegibilidade usada na decisão. A confirmação é um registro de decisão; o consumidor físico ainda deve respeitar `expiresAt` e o bloco apropriado de integração de acesso.

Consulta tenant-scoped:

`GET /api/v1/aggregator/visits/:id`

## Idempotência, concorrência e auditoria

A autorização usa a unicidade física já criada em AGG1 para `(memberId, externalVisitId)`. O fluxo executa em `Serializable` e repete apenas conflitos conhecidos `P2034/P2002`. Em retry após corrida de unicidade, a autorização já persistida é retornada, evitando duplicação de decisão.

A ação de auditoria é `AGGREGATOR_VISIT_AUTHORIZATION_DECIDED` e registra somente campos operacionais da decisão, sem payload bruto de provider, biometria, credencial ou segredo.

## Migration

Nenhuma migration é necessária no AGG3. O bloco utiliza exclusivamente as entidades e constraints persistentes criadas explicitamente no AGG1.

## Fora do escopo

- AGG4: Wellhub Adapter;
- AGG5: TotalPass Adapter + Future Provider Contract;
- AGG6: Provisional Access Policy + Revalidation Engine;
- AGG7: 3-Way Reconciliation + Settlement Ledger + Risk Cases;
- AGG8: Reception Console + Operations Dashboard;
- AGG9: Aggregator Intelligence e Analytics.

A IA permanece fora do caminho crítico de elegibilidade e autorização de visita.
