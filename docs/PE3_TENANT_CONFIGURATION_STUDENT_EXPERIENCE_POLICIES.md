# IRON-PE3 — Tenant Configuration + Student Experience Policies

Data: 05/09/2026  
Baseline: `main @ 9f05a510d4c29f95551f42273cfc7edb3fc8f3eb`.

## 1. Objetivo

Operacionalizar as duas camadas inferiores definidas no PE0 sem permitir que elas ampliem autoridade comercial ou técnica: `TENANT_CONFIGURATION` e `USER_PREFERENCE`. A precedência efetiva permanece:

1. `IRON_POLICY`;
2. `PLAN_ENTITLEMENT`;
3. `TENANT_CONFIGURATION`;
4. `USER_PREFERENCE`.

PE3 evolui o resolvedor canônico do PE2 para que a academia possa restringir a experiência dentro do plano contratado e para que o aluno possa restringir ainda mais sua própria experiência. Nenhuma camada inferior pode habilitar FEATURE negada, aumentar LIMIT ou adicionar POLICY não permitida pela camada superior.

## 2. Persistência

PE3 adiciona duas entidades fisicamente separadas da assinatura financeira do aluno:

- `TenantProductConfiguration`: uma configuração por `gymId + featureKey`;
- `UserProductPreference`: uma preferência por `gymId + userId + featureKey`.

Ambas reutilizam `ProductEntitlementKind` (`FEATURE`, `LIMIT`, `POLICY`) e armazenam exatamente um shape de valor coerente com o kind. A migration contém constraints de shape, índices compostos, FKs tenant/user e é estritamente aditiva.

O modelo financeiro `Subscription` do aluno não é alterado.

## 3. Autoridade e isolamento

Configuração do tenant:

- somente `OWNER` e `MANAGER` podem gravar ou resetar;
- `gymId` nunca vem de body, query ou param;
- o tenant é derivado de `activeGymId ?? gymId` da identidade autenticada;
- `featureKey` precisa existir no catálogo canônico PE0.

Preferência do aluno:

- somente `STUDENT` pode gravar, resetar ou consultar sua preferência pessoal;
- `userId` é sempre o próprio usuário autenticado;
- `gymId` é sempre o tenant autenticado;
- o serviço confirma que existe um `Student` daquele usuário no mesmo tenant antes de operar.

Não existe endpoint para um aluno escolher outro `userId`, outro `gymId`, `planCode` ou versão de plano.

## 4. Monotonicidade por tipo

### FEATURE

Se o plano resolve `false`, tenant e aluno não podem configurar `true`. Se o plano resolve `true`, o tenant pode reduzir para `false`; o aluno pode reduzir novamente dentro do resultado do tenant.

### LIMIT

A configuração precisa ser inteiro não negativo e menor ou igual ao limite da camada superior. O aluno também só pode reduzir.

### POLICY

A camada inferior só pode selecionar subconjunto dos valores permitidos pela camada superior. O catálogo PE0 continua sendo autoridade máxima dos valores canônicos.

## 5. Fail-closed

Persistência inválida ou stale nunca é ignorada de forma a ampliar experiência. O resolvedor retorna o default PE0 quando encontra inconsistência:

- FEATURE → `false`;
- LIMIT → `0`;
- POLICY → `null`.

Razões novas do PE3:

- `INVALID_TENANT_CONFIGURATION`;
- `TENANT_CONFIGURATION_EXCEEDS_PLAN`;
- `INVALID_USER_PREFERENCE`;
- `USER_PREFERENCE_EXCEEDS_TENANT_CONFIGURATION`.

Se o plano já está em `FAIL_CLOSED_DEFAULT`, nenhuma configuração inferior pode sobrescrever esse resultado.

## 6. APIs

Configuração tenant:

- `GET /product-entitlements/tenant/configurations` — OWNER/MANAGER;
- `PUT /product-entitlements/tenant/configurations/:featureKey` — OWNER/MANAGER;
- `DELETE /product-entitlements/tenant/configurations/:featureKey` — OWNER/MANAGER.

Resolução tenant continua disponível nas rotas PE2 e agora inclui `TENANT_CONFIGURATION`:

- `GET /product-entitlements/tenant/features`;
- `GET /product-entitlements/tenant/features/:featureKey`.

Experiência do próprio aluno:

- `GET /product-entitlements/me/features` — STUDENT;
- `GET /product-entitlements/me/features/:featureKey` — STUDENT;
- `GET /product-entitlements/me/preferences` — STUDENT;
- `PUT /product-entitlements/me/preferences/:featureKey` — STUDENT;
- `DELETE /product-entitlements/me/preferences/:featureKey` — STUDENT.

## 7. Concorrência, idempotência e auditoria

Mutações usam transação `Serializable` com retry para conflitos Prisma `P2034/P2002`. `upsert` + uniques compostos tornam a gravação idempotente; repetição do mesmo valor não cria nova linha nem novo AuditLog.

Ações auditadas atomicamente:

- `TENANT_PRODUCT_CONFIGURATION_SET`;
- `TENANT_PRODUCT_CONFIGURATION_RESET`;
- `USER_PRODUCT_PREFERENCE_SET`;
- `USER_PRODUCT_PREFERENCE_RESET`.

## 8. Compatibilidade com PE2 e evolução futura

O plano continua resolvido a partir de `TenantProductSubscription` e `ProductPlanVersion`. Versões `PUBLISHED` e `RETIRED` permanecem válidas para contrato ativo histórico. PE3 apenas acrescenta camadas inferiores e preserva os defaults fail-closed.

Configurações não ficam presas a uma versão de plano. Isso é intencional: uma mudança futura de plano no PE4 revalidará as configurações contra a nova autoridade superior. Se uma configuração antiga passar a exceder o novo plano, o runtime falha fechado até correção/reset, nunca amplia automaticamente o direito.

## 9. Fora de escopo

PE3 não implementa:

- upgrade, downgrade, suspensão, cancelamento, trial, add-on ou troca de plano — PE4;
- pricing, invoice ou cobrança SaaS da FM Tecnologia;
- mudança do `Subscription` financeiro do aluno;
- Creator Network;
- IA;
- novos providers externos;
- bypass de RBAC, direitos autorais, eligibility, acesso físico ou invariantes financeiras.

## 10. Migration

Migration: `20260905130000_tenant_configuration_student_experience_policies`.

Ela cria somente `TenantProductConfiguration` e `UserProductPreference`, seus índices, constraints e FKs. Nenhuma tabela legada é removida, reescrita ou migrada destrutivamente.

## 11. Critério de saída

PE3 somente é aprovado após Prisma generate, npm audit high, lint/typecheck, build e regressão completa verdes, incluindo testes permanentes de isolamento tenant, identidade do aluno, monotonicidade FEATURE/LIMIT/POLICY, fail-closed para configuração stale/inválida, idempotência, auditoria e preservação do domínio financeiro do aluno.
