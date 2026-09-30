# O11 — Financeiro Academia

Status: **CANDIDATE**

Escopo exclusivamente academia → aluno. O Billing IRON (FM Tecnologia → academia) permanece em domínio e superfície separados.

## Autoridade preservada

Todos os endpoints de `/financial` continuam protegidos por:

- `JwtAuthGuard`;
- `RolesGuard`;
- `StepUpGuard`;
- roles `SUPER_ADMIN` / `OWNER`;
- tenant derivado da sessão autenticada.

## Read models adicionados/refinados

### Assinaturas do aluno

`GET /financial/subscriptions`

Filtros:
- `studentId`;
- `status`.

### Cobranças

`GET /financial/charges`

Filtros:
- `studentId`;
- `status`;
- `dueFrom`;
- `dueTo`;
- `overdue`.

`overdue=true` significa cobrança `PENDING` com vencimento anterior ao momento da consulta.

### Histórico financeiro/pagamentos

`GET /financial/transactions`

Filtros:
- aluno;
- conta;
- status;
- tipo;
- período de pagamento.

O read model retorna somente fatos operacionais do financeiro da academia e metadados seguros da conta. Não expõe contratos internos do Billing IRON.
