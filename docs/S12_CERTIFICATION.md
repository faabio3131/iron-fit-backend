# IRON — S12 Full Regression + Adversarial Certification

Status: **CERTIFIED — S0-S12 estabilizado e promovido em `main`**

## Baseline e promoção canônica

- Base canônica de entrada no S12: `bf31244f876fc4022e8c3cdc87b269f8d98a5753`
- Branch de certificação: `stabilization/iron-s12-full-regression-adversarial-certification`
- SHA candidato certificado: `914e35182644af70af30f12e50729ca3e6ba8ea8`
- Branch CI: run `33915102496` — **SUCCESS**
- PR de certificação: **#14 — IRON-S12: Full Regression + Adversarial Certification**
- PR CI: run `33916155740` — **SUCCESS**
- Squash merge S12 em `main`: `4fcff4fe7ecbc54d14c2f9ab95ab7ad3fe22f6cd`
- Gate pós-merge da `main`: run `33916250499` — **SUCCESS**

A certificação S12 foi concluída somente depois de branch gate verde, CI da PR verde, squash merge e gate pós-merge verde sobre o SHA canônico do código certificado.

## Resultado final da matriz de regressão

A certificação executou conjuntamente as suites permanentes S0-S11 e a suite S12, cobrindo:

- auth e refresh/logout;
- tenant context Gym A/B;
- RBAC e atribuição de roles;
- onboarding/identidade do aluno;
- IDOR e portal do aluno;
- equipamentos, agenda e comunicação;
- cadeia de acesso, autenticação de dispositivo e replay;
- financeiro, pagamento, concorrência e idempotência;
- hardening HTTP/API;
- liveness/readiness/observabilidade/runtime;
- AuditLog e consentimentos LGPD;
- adversarial certification S12.

Resultado certificado do gate:

- **71 testes**;
- **71 aprovados**;
- **0 falhas**;
- **0 skipped**;
- **0 vulnerabilidades** no `npm audit --audit-level=high`;
- Prisma generate: success, Prisma 6.19.3;
- lint/typecheck: success;
- build: success.

Nenhuma suite crítica S0-S11 ficou explicitamente marcada com `test.skip`, `it.skip` ou `describe.skip`.

## Blockers encontrados e corrigidos durante S12

### Isolamento de identidade na catraca

Uma credencial pertencente a Gym B podia ser corretamente negada por um dispositivo da Gym A, mas o evento de acesso ainda podia carregar `studentId` da Gym B e a resposta podia expor a identidade do aluno estrangeiro.

Correção S12:

- `studentId` estrangeiro não é persistido no `AccessEvent` da outra academia;
- resposta negada não retorna identidade estrangeira;
- regressão adversarial permanente verifica ausência do ID e nome do aluno de Gym B;
- decisão de acesso passa a gerar AuditLog central sem segredos.

### Idempotência financeira no banco

O pagamento possuía proteção de aplicação/Serializable, mas `FinancialTransaction` ainda não possuía unicidade física para a identidade canônica `gymId + source + sourceId`.

Correção S12:

- Prisma: `@@unique([gymId, source, sourceId])`;
- migration explícita `20260904204000_financial_source_idempotency_unique`;
- a migration falha de forma fechada caso encontre duplicatas históricas não nulas e não reescreve histórico financeiro silenciosamente;
- colisão `P2002` participa da recuperação/retry idempotente do pagamento.

### Operações de workout e assessment sem tenant explícito

Rotas privilegiadas podiam chegar aos services sem tenant, preservando uma antiga possibilidade de consulta sem escopo.

Correção S12:

- workout e assessment exigem tenant ativo;
- SUPER_ADMIN global precisa fornecer tenant explícito para operações de domínio;
- controllers usam `resolveTenantOperationGymId`;
- workout valida assessment contra o mesmo aluno/tenant;
- equipamentos associados ao workout são validados dentro da mesma academia.

### Cobertura central de auditoria

A certificação encontrou cobertura parcial de AuditLog após o S11. O S12 fechou a cobertura dos principais domínios mutáveis:

- auth;
- user/role;
- gym/tenant;
- student/consents;
- assessment;
- workout/status;
- access;
- financial/payment.

Os registros usam actor quando existe identidade humana autenticada, tenant, action, entity/entityId e previous/next quando aplicável. Materiais sensíveis continuam passando pelo sanitizador do `AuditService`.

## Gate permanente

O workflow canônico permanece contendo, no mínimo:

1. `npm ci`
2. `npm audit --audit-level=high`
3. `npx prisma generate`
4. `npm run lint`
5. `npm run build`
6. `npm run test:smoke`

Esses gates permanecem obrigatórios para impedir regressão futura da base certificada.

## Inventário residual conhecido

Os itens abaixo permanecem registrados e **não** devem ser apresentados como implementados:

- MFA continua formalmente pendente; campos de schema não equivalem a fluxo MFA implementado;
- refresh token não possui ainda um absolute maximum lifetime independente das rotações;
- eventos de autenticação usam política fail-safe para que falha de escrita de auditoria não revele nem altere o resultado de autenticação;
- Prisma emite aviso de depreciação para configuração em `package.json` visando Prisma 7; a versão certificada continua Prisma 6.19.3.

Esses itens permanecem no inventário de evolução e não invalidaram os gates obrigatórios da certificação S12.

## Conclusão

O ciclo de estabilização **S0-S12 está formalmente CERTIFIED** no código canônico promovido pelo PR #14 e validado novamente em `main` pelo run `33916250499`.

A partir deste marco, novas fases devem respeitar a sequência arquitetural posterior definida na Ordem Mestre. A certificação S12 não significa que funcionalidades futuras — Aggregator Hub, Creator Network, AI0/AI+ ou residuais explicitamente listados — estejam implementadas.
