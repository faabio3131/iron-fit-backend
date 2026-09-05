# IRON-PE2 — Tenant Subscription + Feature Resolution Engine

Data: 05/09/2026  
Baseline: `main @ 809f5bb4584e27a1e1ced41d1427b38254e76a74`.

## 1. Objetivo

Ligar cada academia a uma versão imutável e publicada do produto SaaS IRON e disponibilizar um resolvedor canônico, determinístico e fail-closed de FEATURE, LIMIT e POLICY. PE2 consome os contratos PE0 e o catálogo persistente PE1 sem introduzir ainda configuração tenant, preferência de usuário, upgrade/downgrade, pricing ou Creator Network.

## 2. Separação obrigatória

`TenantProductSubscription` representa a assinatura SaaS da academia com a FM Tecnologia. O `Subscription` já existente continua exclusivamente financeiro e ligado a `gymId + studentId + amount`. Os dois domínios não compartilham semântica, cobrança nem status.

A assinatura SaaS aponta para `ProductPlanVersion`, nunca para nome comercial solto. A versão permanece a referência contratual exata mesmo se posteriormente for `RETIRED` para novas adesões.

## 3. Persistência e invariantes

PE2 cria `TenantProductSubscription` com `gymId`, `planVersionId`, status, janela de vigência e timestamps. A migration é aditiva e cria índice parcial único garantindo no máximo uma assinatura `ACTIVE` por academia.

Nova atribuição exige cumulativamente:

- academia existente e ativa;
- `planCode + version` existente;
- versão em estado `PUBLISHED` no momento da adesão;
- inexistência de outro plano ativo para o tenant.

Repetir exatamente a mesma atribuição ativa é idempotente. Trocar um plano ativo por outro não é feito em PE2: falha com conflito porque upgrade/downgrade e transições pertencem ao PE4.

## 4. Autoridade tenant

Leituras tenant não aceitam `gymId` em body, query ou param. O tenant é derivado exclusivamente de `activeGymId ?? gymId` da identidade autenticada. Ausência de tenant ativo falha fechada.

A única operação que recebe `gymId` explicitamente é a atribuição comercial global `SUPER_ADMIN` da FM Tecnologia, pois o alvo é uma academia administrada globalmente e não o tenant operacional do ator.

## 5. Resolver canônico

O resolvedor usa `PRODUCT_FEATURE_CATALOG_V1` como autoridade de tipo e default. Para uma assinatura ativa de uma academia ativa:

1. localiza a versão contratada;
2. aceita `PUBLISHED` ou `RETIRED` para preservar contratos históricos ativos;
3. procura a `featureKey` canônica naquela versão;
4. valida novamente o shape persistido;
5. retorna o valor do plano quando válido.

Qualquer ausência ou inconsistência retorna o default fail-closed do PE0:

- FEATURE → `false`;
- LIMIT → `0`;
- POLICY → `null`.

Razões canônicas de fallback nesta fase: `TENANT_INACTIVE_OR_MISSING`, `NO_ACTIVE_TENANT_SUBSCRIPTION`, `PLAN_VERSION_NOT_EFFECTIVE`, `ENTITLEMENT_NOT_GRANTED` e `INVALID_ENTITLEMENT_DATA`.

O resolvedor não conhece nomes comerciais de planos e não concede capability por inferência.

## 6. API

Operação global:

- `POST /product-entitlements/tenant-subscriptions` — `SUPER_ADMIN` — atribuição inicial explícita.

Leituras tenant, sempre derivadas da identidade autenticada:

- `GET /product-entitlements/tenant/current`;
- `GET /product-entitlements/tenant/features`;
- `GET /product-entitlements/tenant/features/:featureKey`.

As leituras podem servir os papéis autenticados do tenant porque apenas revelam o contrato efetivo do próprio tenant; não permitem mutação.

## 7. Concorrência, idempotência e auditoria

Atribuição usa transação `Serializable`, retry limitado para conflitos Prisma `P2034/P2002`, índice parcial único de plano ativo e `AuditLog` atômico `TENANT_PRODUCT_SUBSCRIPTION_ASSIGNED`.

O resolvedor é read-only e consulta sempre com `gymId` explícito derivado da autenticação.

## 8. Fora de escopo

PE2 não implementa:

- configuração de academia ou preferência do aluno/usuário — PE3;
- upgrade, downgrade, troca, suspensão, cancelamento, trial ou add-on — PE4;
- preço, invoice, gateway ou cobrança SaaS da FM Tecnologia;
- alteração do `Subscription` financeiro do aluno;
- Creator Network;
- IA;
- bypass direto de módulos por nome de plano.

## 9. Migration

Migration: `20260905121500_tenant_product_subscription_feature_resolution`.

Cria somente enum/tabela/índices/FKs/check de `TenantProductSubscription` e relações correspondentes no Prisma. Nenhuma tabela financeira ou legado é removida ou reescrita.

## 10. Critério de saída

PE2 só é aprovado após Prisma generate, npm audit high, lint/typecheck, build e regressão completa verdes, com testes permanentes para separação do Subscription financeiro, isolamento tenant, atribuição idempotente, bloqueio de troca antecipada, versão publicada/retirada, defaults fail-closed e ausência de PE3/PE4 antecipados.
