# IRON — AGG6 Provisional Access Policy + Revalidation Engine

Status: **CANDIDATE — IRON-AGG6**

Baseline canônica: `main @ c2ba38d8854acd80534c99e385d9746d8971ce39`

## Escopo

AGG6 operacionaliza acesso provisório de forma determinística e auditável para falhas transitórias do provider e implementa o motor provider-neutral de revalidação. O bloco usa as entidades `AggregatorProvisionalDecision` e `AggregatorRevalidationAttempt` criadas no AGG1 e não cria acesso físico, settlement, reconciliação, dashboard ou IA.

## Regra fundamental

Acesso provisório **não é fallback genérico de autorização**. Ele só pode ser considerado quando a decisão canônica AGG3 já existe e foi `DENIED` especificamente por `ELIGIBILITY_UNKNOWN`.

Nunca é permitido transformar em provisório um bloqueio causado por:

- conexão de provider não ativa;
- acordo não assinado;
- evidência `INELIGIBLE`;
- ausência de homologação;
- evidência sem validade;
- timestamp inválido;
- falta genérica de evidência;
- qualquer motivo desconhecido que não represente falha transitória explícita de transporte.

`UNKNOWN` continua diferente de `ELIGIBLE` em todos os caminhos.

## Política explícita e fail-closed

AGG6 não define duração implícita nem TTL de provider. A política deve existir explicitamente no `configuration` da conexão, sob a chave `provisionalAccessPolicy`:

```json
{
  "provisionalAccessPolicy": {
    "enabled": true,
    "version": "gym-policy-v1",
    "maxDurationMinutes": 15,
    "eligibilityLookbackMinutes": 1440,
    "maxRevalidationAttempts": 3
  }
}
```

Sem configuração, com `enabled != true` ou com valores inválidos, a decisão falha fechada como `DENIED`.

Há limites de segurança da plataforma, não confundidos com TTL de provider: duração provisória no máximo 120 minutos, lookback no máximo 7 dias e no máximo 10 tentativas de revalidação. O valor efetivo dentro desses limites é sempre explícito e versionado por tenant/conexão.

## Condições cumulativas para aprovação provisória

A decisão provisória exige simultaneamente:

1. tenant ativo derivado do contexto autenticado;
2. operador autenticado responsável pela decisão;
3. visita AGG3 existente no tenant;
4. status da visita `DENIED` com `ELIGIBILITY_UNKNOWN`;
5. conexão do provider ainda `ACTIVE`;
6. acordo associado ainda `SIGNED`;
7. evidência mais recente persistida como `UNKNOWN` por falha transitória de transporte (`*_TRANSPORT_UNAVAILABLE` ou código canônico equivalente);
8. evidência anterior `ELIGIBLE` dentro do lookback explícito da política;
9. política habilitada e válida.

Quando aprovada, a visita muda para `PROVISIONAL` e recebe uma janela própria do IRON. Isso **não grava `AccessEvent` e não libera catraca diretamente**; a cadeia física permanece separada.

## Snapshot de política

A decisão registra em `metadata` os parâmetros usados (`maxDurationMinutes`, `eligibilityLookbackMinutes`, `maxRevalidationAttempts`) e as referências da evidência `UNKNOWN` e da evidência anterior `ELIGIBLE`. A revalidação usa esse snapshot, não uma política alterada posteriormente.

## Revalidation Engine

A revalidação opera sobre uma visita `PROVISIONAL` com decisão `APPROVED`:

- somente evidência criada após a decisão provisória pode confirmar ou reprovar a revalidação;
- evidência fresca e válida `ELIGIBLE` cria tentativa `CONFIRMED` e promove a visita para `CONFIRMED`;
- evidência fresca `INELIGIBLE` cria tentativa `FAILED`, revoga a decisão provisória e marca a visita `FAILED`;
- ausência de evidência fresca ou resultado `UNKNOWN` cria tentativa `UNKNOWN` e mantém o estado provisório enquanto ainda houver janela e tentativas;
- janela expirada ou limite de tentativas alcançado muda a decisão para `EXPIRED` e a visita para `FAILED`.

Cada tentativa possui número monotônico por visita, status, referência externa quando disponível, `reasonCode`, provenance e `completedAt`.

## Concorrência, idempotência e auditoria

As decisões e revalidações usam transações `Serializable` com retry para conflitos `P2034/P2002`. A relação única `visitAuthorizationId` da decisão impede múltiplas decisões concorrentes para a mesma visita, e `@@unique([visitAuthorizationId, attempt])` impede duplicidade de tentativa.

São gerados eventos de auditoria para aprovação/negação provisória, mudança da visita para `PROVISIONAL`, confirmação da revalidação, falha, resultado `UNKNOWN` e expiração.

## Fronteira de responsabilidade

AGG6 é provider-neutral. Wellhub, TotalPass e providers futuros continuam responsáveis por registrar nova evidência canônica por seus adapters. O motor AGG6 consome essa evidência; ele não conhece endpoint, credencial, webhook, assinatura ou rate limit de provider.

AGG6 não escreve:

- `AccessEvent`;
- `AggregatorAccessEventLink`;
- `AggregatorSettlement`;
- `AggregatorReconciliation`;
- `AggregatorRiskCase`.

Essas responsabilidades permanecem nos blocos canônicos posteriores.

## Critério de saída

- política provisória explícita, versionada e fail-closed;
- nenhuma autorização provisória para `INELIGIBLE`, acordo inválido ou conexão inativa;
- revalidação com evidência fresca e limite determinístico;
- multi-tenant preservado;
- transações serializáveis e auditoria permanente;
- testes adversariais cobrindo aprovação, recusas, cross-tenant, confirmação, reprovação e exaustão;
- npm audit high, Prisma generate, lint/typecheck, build e regressão verdes;
- diff restrito ao AGG6.
