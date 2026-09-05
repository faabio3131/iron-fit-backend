# IRON — AGG9 Aggregator Intelligence e Analytics

Status: **CANDIDATE — IRON-AGG9**

Baseline canônica: `main @ c58476ad5db03a66920b84a3930ebc97a337d09f`

## Objetivo

AGG9 fecha o Aggregator Hub com uma camada de inteligência operacional e analytics sobre os fatos canônicos produzidos por AGG1–AGG8. O bloco é **read-only, agregado, provider-neutral e advisory**. Ele não participa da autorização de visita, não altera settlement/reconciliation/risk e não executa ações autônomas.

## Endpoints

Todos os endpoints usam `JwtAuthGuard` + `RolesGuard`, aceitam apenas `SUPER_ADMIN`, `OWNER` e `MANAGER` e derivam o tenant de `CurrentUser.activeGymId ?? CurrentUser.gymId`.

- `GET /api/v1/aggregator/intelligence/overview?days=30`
  - KPIs por estado de visitas, settlements, reconciliations e risk cases;
  - taxas determinísticas: confirmação, provisório, negação/falha, settlement recebido, exceções de settlement e reconciliação;
  - sinais de atenção somente quando existem fatos canônicos que exigem acompanhamento.

- `GET /api/v1/aggregator/intelligence/providers?days=30`
  - breakdown agregado por `providerCode`;
  - contagens de visits/settlements/reconciliations/risks;
  - taxas por provider;
  - valores financeiros agrupados por moeda, sem somar moedas diferentes entre si.

- `GET /api/v1/aggregator/intelligence/trends?days=30`
  - série diária bounded para visitas, confirmações, provisórios, negações/falhas, settlements recebidos, exceções financeiras, reconciliations e risk cases criados.

A janela é validada por DTO e limitada a **1–90 dias**, com padrão de 30 dias.

## Segurança e privacidade

- nenhum DTO aceita `gymId`;
- ausência de tenant ativo falha fechada antes de qualquer leitura;
- todas as consultas começam pelo tenant autenticado;
- endpoints são exclusivamente gerenciais: `RECEPTION`, `TRAINER` e `STUDENT` não recebem acesso;
- respostas são agregadas e não retornam `memberId`, `studentId`, `externalMemberId`, nome, e-mail, telefone ou credenciais;
- valores financeiros são preservados por moeda; não existe conversão cambial implícita.

## Inteligência determinística

AGG9 não cria uma nova autoridade de negócio. Os sinais são advisory e possuem `criticalPathImpact: false`.

Sinais canônicos implementados:

- `UNRESOLVED_RISK_CASES` — existe risk case `OPEN` ou `REVIEWING`;
- `SETTLEMENT_EXCEPTIONS` — existe settlement `DIVERGENT`, `DISPUTED` ou `EXPIRED`;
- `RECONCILIATION_GAPS` — existe reconciliation diferente de `RECONCILED`;
- `PROVISIONAL_VISITS` — existe visita em estado `PROVISIONAL`.

Não são usados thresholds arbitrários, score opaco ou regra específica de provider. O sinal apenas projeta a existência e a contagem do fato canônico correspondente.

## Separação do caminho crítico

AGG9 não pode:

- transformar `UNKNOWN` em `ELIGIBLE`;
- autorizar, negar ou revalidar visita;
- criar ou alterar `AccessEvent`;
- registrar ou confirmar settlement;
- reconciliar fatos;
- abrir/fechar risk cases;
- disparar ação operacional automática;
- chamar LLM/modelo externo ou executar predição que influencie catraca, pagamento ou settlement.

A inteligência avançada baseada em modelos pertence ao **IRON Intelligence Layer (AI0/AI+)**, sob governança própria. AGG9 entrega analytics determinísticos e sinais explicáveis para decisão humana.

## Provider neutrality

Toda atribuição de provider é feita por `providerCode` já canônico em `AggregatorProviderConnection`. Nenhum endpoint, contrato, TTL, rate limit, webhook ou credencial privada de Wellhub, TotalPass ou futuro provider é inventado neste bloco.

## Migration

Nenhuma migration nova é necessária. AGG9 é uma projeção analítica das estruturas criadas e estabilizadas em AGG1–AGG8.

## Critério de saída

- overview gerencial tenant-scoped;
- provider analytics sem PII e com moedas separadas;
- trends bounded de 1–90 dias;
- sinais determinísticos, advisory e explicáveis;
- camada estritamente read-only;
- nenhum impacto no caminho crítico de autorização/acesso/settlement;
- testes permanentes para tenant, RBAC, agregação, privacidade, currency safety e ausência de mutações/IA;
- npm audit high, Prisma generate, lint/typecheck, build e regressão verdes;
- diff restrito ao AGG9.
