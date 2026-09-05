# IRON — AGG8 Reception Console + Operations Dashboard

Status: **CANDIDATE — IRON-AGG8**

Baseline canônica: `main @ 72e118911e49fa20efc03ccd594467db1142e7b4`

## Objetivo

AGG8 transforma os estados canônicos já produzidos por AGG1–AGG7 em superfícies operacionais seguras para recepção e gestão. O bloco é deliberadamente **read-only**: não cria decisão de elegibilidade, não autoriza visita, não cria `AccessEvent`, não registra settlement e não executa reconciliação.

## Endpoints

Todos os endpoints usam `JwtAuthGuard` + `RolesGuard` e derivam o tenant exclusivamente de `CurrentUser.activeGymId ?? CurrentUser.gymId`.

- `GET /api/v1/aggregator/operations/summary`
  - roles: `SUPER_ADMIN`, `OWNER`, `MANAGER`, `RECEPTION`;
  - snapshot operacional por status de connections, visits, settlements, reconciliations e risk cases;
  - não expõe valores financeiros individuais.

- `GET /api/v1/aggregator/operations/reception-queue?limit=25`
  - roles: `SUPER_ADMIN`, `OWNER`, `MANAGER`, `RECEPTION`;
  - fila de atenção operacional de visitas;
  - códigos determinísticos: autorização pendente/falha, revalidação, entrada física pendente e reconciliação pendente/divergente;
  - não retorna `amountExpected`, `amountConfirmed` ou `potentialAmount`.

- `GET /api/v1/aggregator/operations/risk-queue?limit=25`
  - roles: `SUPER_ADMIN`, `OWNER`, `MANAGER`;
  - somente riscos `OPEN`/`REVIEWING` do tenant;
  - pode expor valores canônicos de risco/settlement porque recepção não possui acesso a esta rota.

- `GET /api/v1/aggregator/operations/settlement-queue?limit=25`
  - roles: `SUPER_ADMIN`, `OWNER`, `MANAGER`;
  - somente settlements ainda operacionais: `EXPECTED`, `CONFIRMED`, `DIVERGENT`, `DISPUTED` ou `EXPIRED`;
  - `RECEIVED` final não entra na fila pendente.

O parâmetro `limit` é validado por DTO, inteiro entre 1 e 100.

## Segurança multi-tenant

Nenhum endpoint aceita `gymId` em body/query/DTO como autoridade. Todas as consultas começam pelo tenant autenticado:

- Provider Connection: `gymId` direto;
- Visit Authorization: `member.connection.gymId`;
- Settlement: `connection.gymId`;
- Risk Case: `connection.gymId`;
- Reconciliation: vínculo tenant-scoped por `visitAuthorization.member.connection` ou por `settlement.connection`.

Ausência de tenant ativo falha fechada com `400` antes de qualquer leitura.

## Separação de privilégios

A recepção precisa visualizar o estado da visita para atendimento, mas não precisa acessar exposição financeira detalhada. Por isso:

- `summary` e `reception-queue` aceitam `RECEPTION`;
- `risk-queue` e `settlement-queue` restringem-se a `SUPER_ADMIN`, `OWNER` e `MANAGER`;
- a fila de recepção não seleciona nem retorna valores financeiros.

## Determinismo operacional

AGG8 não cria nova verdade de negócio. Ele apenas projeta estados já persistidos:

- `PROVISIONAL` → `REVALIDATION_REQUIRED`;
- `PENDING` → `AUTHORIZATION_PENDING`;
- `DENIED`/`FAILED` → `AUTHORIZATION_FAILED`;
- `CONFIRMED` sem vínculo físico → `AWAITING_PHYSICAL_ENTRY`;
- reconciliação não `RECONCILED` → `RECONCILIATION_<STATUS>`;
- `CONFIRMED` + entrada física sem reconciliação → `RECONCILIATION_REQUIRED`.

Visita já reconciliada e sem outra pendência não aparece na fila de recepção.

## Fronteiras do bloco

AGG8 não implementa:

- frontend visual específico; este repositório é o backend e entrega as APIs canônicas do console;
- alteração de agreement, eligibility, visit authorization ou provisional policy;
- criação/vínculo automático de `AccessEvent`;
- escrita/atualização de settlement, reconciliation ou risk case;
- tendências, scoring, anomalias, predição, recomendação ou IA — pertencem ao AGG9;
- contratos privados, endpoints ou credenciais de Wellhub/TotalPass.

## Migration

Nenhuma nova migration é necessária. AGG8 consome somente entidades e constraints já canônicas do AGG1–AGG7.

## Critério de saída

- console operacional tenant-scoped;
- fila de recepção sem exposição financeira detalhada;
- filas gerenciais de risco/settlement com RBAC explícito;
- ausência de mutações no serviço AGG8;
- limite de consulta validado e bounded;
- testes permanentes de tenant, RBAC, projeção determinística e read-only;
- npm audit high, Prisma generate, lint/typecheck, build e regressão verdes;
- diff restrito ao AGG8.
