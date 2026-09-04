# IRON — S12 Full Regression + Adversarial Certification

Status: **CANDIDATE — aguardando gate final e PR de certificacao**

## Baseline

- Base canonica de entrada no S12: `bf31244f876fc4022e8c3cdc87b269f8d98a5753`
- Branch: `stabilization/iron-s12-full-regression-adversarial-certification`
- Regra: nenhum status global de 100% pode ser declarado antes do gate final, CI da PR e merge do S12 em `main`.

## Matriz obrigatoria de regressao

A certificacao executa conjuntamente as suites permanentes S0-S11 e a suite S12, cobrindo:

- auth e refresh/logout;
- tenant context Gym A/B;
- RBAC e atribuicao de roles;
- onboarding/identidade do aluno;
- IDOR e portal do aluno;
- equipamentos, agenda e comunicacao;
- cadeia de acesso, autenticacao de dispositivo e replay;
- financeiro, pagamento, concorrencia e idempotencia;
- hardening HTTP/API;
- liveness/readiness/observabilidade/runtime;
- AuditLog e consentimentos LGPD;
- adversarial certification S12.

Nenhuma suite critica S0-S11 pode estar explicitamente marcada com `test.skip`, `it.skip` ou `describe.skip`.

## Blockers encontrados e corrigidos durante S12

### Isolamento de identidade na catraca

Uma credencial pertencente a Gym B podia ser corretamente negada por um dispositivo da Gym A, mas o evento de acesso ainda podia carregar `studentId` da Gym B e a resposta podia expor a identidade do aluno estrangeiro.

Correcao S12:

- `studentId` estrangeiro nao e persistido no `AccessEvent` da outra academia;
- resposta negada nao retorna identidade estrangeira;
- regressao adversarial permanente verifica ausencia do ID e nome do aluno de Gym B;
- decisao de acesso passa a gerar AuditLog central sem segredos.

### Idempotencia financeira no banco

O pagamento possuia protecao de aplicacao/Serializable, mas `FinancialTransaction` ainda nao possuia unicidade fisica para a identidade canonica `gymId + source + sourceId`.

Correcao S12:

- Prisma: `@@unique([gymId, source, sourceId])`;
- migration explicita `20260904204000_financial_source_idempotency_unique`;
- a migration falha de forma fechada caso encontre duplicatas historicas nao nulas e nao reescreve historico financeiro silenciosamente;
- colisao `P2002` participa da recuperacao/retry idempotente do pagamento.

### Operacoes de workout e assessment sem tenant explicito

Rotas privilegiadas podiam chegar aos services sem tenant, preservando uma antiga possibilidade de consulta sem escopo.

Correcao S12:

- workout e assessment exigem tenant ativo;
- SUPER_ADMIN global precisa fornecer tenant explicito para operacoes de dominio;
- controllers usam `resolveTenantOperationGymId`;
- workout valida assessment contra o mesmo aluno/tenant;
- equipamentos associados ao workout sao validados dentro da mesma academia.

### Cobertura central de auditoria

A certificacao encontrou cobertura parcial de AuditLog apos o S11. O S12 fecha a cobertura dos principais dominios mutaveis:

- auth;
- user/role;
- gym/tenant;
- student/consents;
- assessment;
- workout/status;
- access;
- financial/payment.

Os registros usam actor quando existe identidade humana autenticada, tenant, action, entity/entityId e previous/next quando aplicavel. Materiais sensiveis continuam passando pelo sanitizador do `AuditService`.

## Gate permanente

O workflow canonico deve permanecer contendo, no minimo:

1. `npm ci`
2. `npm audit --audit-level=high`
3. `npx prisma generate`
4. `npm run lint`
5. `npm run build`
6. `npm run test:smoke`

A certificacao final deve registrar total de testes, failures, skipped, SHA do candidato, run ID da branch, run ID da PR e SHA final da `main`.

## Inventario residual conhecido

Os itens abaixo permanecem registrados e nao devem ser apresentados como implementados:

- MFA continua formalmente pendente; campos de schema nao equivalem a fluxo MFA implementado;
- refresh token nao possui ainda um absolute maximum lifetime independente das rotacoes;
- eventos de autenticacao usam politica fail-safe para que falha de escrita de auditoria nao revele nem altere o resultado de autenticacao;
- Prisma emite aviso de deprecacao para configuracao em `package.json` visando Prisma 7; a versao atual continua Prisma 6.19.3.

Esses itens permanecem no inventario de evolucao. Qualquer novo residual critico descoberto pelo gate S12 bloqueia a certificacao ate correcao ou decisao formal do Diretor.

## Condicao de fechamento

Este documento somente muda de **CANDIDATE** para **CERTIFIED** depois de:

- branch CI integral verde;
- zero failure e zero skipped critico;
- revisao de dependencies/migrations concluida;
- PR S12 aberta e CI da PR verde;
- squash merge do S12 em `main`;
- captura do SHA canonico final.
