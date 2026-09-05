# IRON-PE3 — Tenant Configuration + Student Experience Policies

Data: 05/09/2026  
Baseline: `main @ 9f05a510d4c29f95551f42273cfc7edb3fc8f3eb`.

## 1. Objetivo

Operationalizar as duas camadas inferiores da precedência definida no PE0 sem permitir ampliação de autoridade: `TENANT_CONFIGURATION` e `USER_PREFERENCE`. A academia pode estreitar aquilo que o plano SaaS efetivamente concede; o aluno pode estreitar ainda mais sua própria experiência. Nenhuma configuração cria entitlement inexistente.

Precedência efetiva preservada:

`IRON_POLICY > PLAN_ENTITLEMENT > TENANT_CONFIGURATION > USER_PREFERENCE`.

O catálogo técnico PE0 continua sendo a fronteira de política IRON; o PE2 continua sendo a autoridade sobre assinatura SaaS e entitlement do plano.

## 2. Persistência

A migration `20260905140500_tenant_configuration_student_experience` cria duas tabelas aditivas:

- `TenantProductConfiguration`: uma configuração por `(gymId, featureKey)`;
- `StudentProductPreference`: uma preferência por `(studentId, featureKey)`.

As duas usam o enum já existente `ProductEntitlementKind` e armazenam exatamente um shape por tipo:

- FEATURE → `featureEnabled`;
- LIMIT → `limitValue >= 0`;
- POLICY → `policyValues` JSON array.

CHECK constraints físicas impedem mistura de shapes. FKs preservam isolamento e lifecycle: configuração tenant referencia `Gym`; preferência referencia `Student`.

A migration explícita e o `prisma/schema.prisma` representam as duas tabelas e suas relações, evitando schema drift entre o banco e o modelo canônico do repositório. O serviço usa SQL parametrizado através do cliente Prisma para manter validação dos shapes e UPSERTs atômicos diretamente sobre as constraints físicas; não há ampliação de autoridade nem bypass de isolamento tenant.

## 3. Regras de estreitamento

A escrita sempre valida a `featureKey` contra `PRODUCT_FEATURE_CATALOG_V1` e exige `kind` idêntico ao contrato canônico.

FEATURE:

- plano `false` nunca pode virar `true` em tenant;
- tenant `false` nunca pode virar `true` por preferência do aluno.

LIMIT:

- tenant só pode gravar valor menor ou igual ao limite do plano;
- aluno só pode gravar valor menor ou igual ao limite efetivo do tenant.

POLICY:

- tenant só pode selecionar subconjunto dos valores autorizados pelo plano;
- aluno só pode selecionar subconjunto do conjunto efetivo do tenant;
- valores fora da taxonomia PE0 são rejeitados.

Atualizar uma configuração pode ampliar em relação à configuração anterior somente até o teto da camada superior, o que preserva a monotonicidade entre camadas.

## 4. Fail-closed

Ausência de configuração significa herdar a camada superior. Dado persistido inválido ou que tente ampliar a camada superior não é ignorado silenciosamente: a resolução retorna o default PE0 com razão explícita:

- `INVALID_TENANT_CONFIGURATION`;
- `INVALID_STUDENT_PREFERENCE`.

Isso evita que corrupção de configuração produza expansão acidental por fallback ao plano.

## 5. Autoridade e isolamento tenant

Nenhuma rota operacional aceita `gymId` em body, query ou param. O tenant é derivado de `activeGymId ?? gymId` da identidade autenticada.

Configuração tenant:

- leitura efetiva: usuários autenticados do próprio tenant;
- escrita/remoção: `SUPER_ADMIN`, `OWNER` e `MANAGER`;
- `RECEPTION`, `TRAINER` e `STUDENT` não alteram configuração da academia.

Preferência de aluno:

- somente role `STUDENT`;
- o `studentId` nunca vem do cliente;
- o backend resolve `Student` por `userId + gymId + status ACTIVE`;
- aluno de Gym A não consegue selecionar registro de Gym B.

## 6. APIs

Experiência tenant:

- `GET /product-entitlements/tenant/effective/features`;
- `GET /product-entitlements/tenant/effective/features/:featureKey`;
- `PUT /product-entitlements/tenant/configurations/:featureKey`;
- `DELETE /product-entitlements/tenant/configurations/:featureKey`.

Experiência do aluno:

- `GET /product-entitlements/student/effective/features`;
- `GET /product-entitlements/student/effective/features/:featureKey`;
- `PUT /product-entitlements/student/preferences/:featureKey`;
- `DELETE /product-entitlements/student/preferences/:featureKey`.

## 7. Concorrência, idempotência e auditoria

Mutações usam transação `Serializable` com retry limitado para `P2034/P2002`.

UPSERTs usam as constraints únicas `(gymId, featureKey)` e `(studentId, featureKey)`, tornando retries idempotentes sobre a mesma chave lógica.

Toda alteração ou remoção efetiva é auditada atomicamente:

- `TENANT_PRODUCT_CONFIGURATION_SET`;
- `TENANT_PRODUCT_CONFIGURATION_CLEARED`;
- `STUDENT_PRODUCT_PREFERENCE_SET`;
- `STUDENT_PRODUCT_PREFERENCE_CLEARED`.

Remover configuração/preferência inexistente é idempotente e não gera auditoria falsa.

## 8. Fora de escopo

PE3 não implementa:

- upgrade/downgrade, suspensão, cancelamento ou troca de ProductPlan — PE4;
- pricing, invoice, gateway ou cobrança SaaS da FM Tecnologia;
- alteração do `Subscription` financeiro do aluno;
- novas capabilities comerciais;
- Creator Network;
- IA;
- alteração de RBAC/Core para transformar feature flag em autorização de segurança.

## 9. Critério de saída

PE3 somente pode ser aprovado após migration e schema auditados em conjunto, Prisma generate, lint/typecheck, build, npm audit high e regressão completa verdes, com testes permanentes para monotonicidade FEATURE/LIMIT/POLICY, isolamento Gym A/Gym B, student self-resolution, fail-closed, alinhamento migration/schema e ausência de antecipação PE4.
