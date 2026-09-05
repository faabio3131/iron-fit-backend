# IRON — AGG7 3-Way Reconciliation + Settlement Ledger + Risk Cases

Status: **CANDIDATE — IRON-AGG7**

Baseline canônica: `main @ 3a6542ac01f1cef691049a0a4b2f84d757c482db`

## Objetivo

AGG7 operacionaliza três fatos independentes do Aggregator Hub:

1. **autorização da visita** — decisão determinística do IRON;
2. **entrada física** — `AccessEvent` real já produzido pela cadeia física e apenas vinculado ao Aggregator;
3. **evidência financeira/provider** — `AggregatorSettlement` registrado no ledger.

A reconciliação não permite que um desses fatos substitua outro. Contrato identifica a relação; elegibilidade válida autoriza a visita; entrada física prova ocorrência local; settlement recebido valida a receita.

## Settlement Ledger

O endpoint interno autenticado `POST /api/v1/aggregator/settlements/evidence` registra evidência provider-neutral. O tenant é derivado da identidade autenticada; `gymId` não existe no DTO.

A identidade idempotente do settlement é a constraint canônica `(connectionId, externalSettlementId)`. Reenvio do mesmo identificador atualiza a evolução da evidência em vez de criar duplicata. Mudança de `externalVisitId`, vínculo de visita ou moeda conflitante falha fechada.

O ledger persiste somente campos canônicos: status, IDs externos, valores, moeda, período, providerStatus e `evidenceRef`. Payload bruto, credenciais, tokens, headers, webhooks e segredos não são persistidos.

`CONFIRMED` significa confirmação provider-side ainda não equivalente a receita recebida. Para reconciliação financeira final, o estado exigido é `RECEIVED`.

## Vínculo com entrada física

AGG7 não cria `AccessEvent`. Ele somente pode vincular um `AccessEvent` já existente e `allowed=true` a uma visita `CONFIRMED` ou `PROVISIONAL`.

O vínculo exige:

- visita no tenant ativo;
- evento físico no mesmo tenant;
- `studentId` do membro aggregator presente;
- `studentId` do AccessEvent presente;
- identidade local exatamente igual;
- relação one-to-one já garantida no schema por `visitAuthorizationId @unique` e `accessEventId @unique`.

Um evento negado, cross-tenant ou de outro aluno nunca pode ser convertido em entrada reconciliável.

## Matriz 3-way

A classificação canônica segue regras conservadoras:

- mais de um settlement associado à mesma visita → `DUPLICATE`;
- entrada física negada ou ligada a visita final não autorizada → `MANUAL_REVIEW`;
- provider confirmou/recebeu para visita final não autorizada → `MANUAL_REVIEW`;
- settlement `DISPUTED` → `MANUAL_REVIEW`;
- status `DIVERGENT` ou `amountExpected != amountConfirmed` → `AMOUNT_DIVERGENCE`;
- settlement `EXPIRED` após autorização/entrada → `UNPAID_RISK`;
- provider confirmado/recebido sem entrada física → `MISSING_PHYSICAL_ENTRY`;
- visita `CONFIRMED` + entrada física, mas sem settlement/provider record → `MISSING_PROVIDER_CHECKIN`;
- visita `CONFIRMED` + entrada física + settlement `RECEIVED` coerente → `RECONCILED`;
- estados ainda legitimamente incompletos, inclusive `PROVISIONAL`, ficam `PENDING` em vez de gerar conclusão falsa.

`RECONCILED` exige os três fatos coerentes. Settlement sozinho nunca autoriza visita nem prova entrada física.

## Risk Cases

Estados de divergência abrem ou atualizam `AggregatorRiskCase`:

- `MISSING_PROVIDER_CHECKIN`;
- `MISSING_PHYSICAL_ENTRY`;
- `UNPAID_RISK`;
- `AMOUNT_DIVERGENCE`;
- `DUPLICATE`;
- `MANUAL_REVIEW`.

Settlement sem qualquer autorização de visita vinculada gera `ORPHAN_SETTLEMENT` e reconciliação `MANUAL_REVIEW`.

Quando uma nova execução deixa de apresentar a divergência anterior, risk cases AGG7 ainda `OPEN/REVIEWING` da visita são resolvidos automaticamente. A trilha histórica permanece no AuditLog.

## Idempotência e concorrência

Settlement tem unicidade física por `(connectionId, externalSettlementId)`. Link físico tem unicidade física por visita e AccessEvent. Reconciliation e risk case são mantidos como registros canônicos lógicos por busca idempotente dentro de transação PostgreSQL `Serializable`, com retry de `P2034/P2002`; o AuditLog preserva cada mudança de estado.

Não há migration no AGG7 porque todas as entidades e constraints estruturais necessárias já foram criadas no AGG1.

## Segurança multi-tenant

Todas as mutações começam por `gymId` derivado de `CurrentUser`. Connection, VisitAuthorization e AccessEvent são consultados dentro desse tenant antes de qualquer escrita. Nenhum DTO aceita `gymId` como autoridade.

## Fronteiras do bloco

AGG7 não implementa:

- endpoint, credencial, webhook ou regra privada de Wellhub/TotalPass;
- criação ou acionamento de catraca;
- lógica de cobrança do SaaS;
- console de recepção/dashboard (AGG8);
- inteligência/anomalias por IA (AGG9);
- alteração de decisão de elegibilidade AGG3 ou política provisória AGG6.

## Critério de saída

- settlement ledger tenant-scoped e idempotente;
- vínculo físico seguro e one-to-one;
- matriz 3-way determinística e conservadora;
- risk cases deduplicados/resolvíveis;
- orphan settlement detectável;
- AuditLog e `Serializable` em todas as mutações críticas;
- testes adversariais de tenant, identidade, duplicidade, divergência, missing facts e reconciliação completa;
- npm audit high, Prisma generate, lint/typecheck, build e regressão verdes;
- diff restrito ao AGG7.
