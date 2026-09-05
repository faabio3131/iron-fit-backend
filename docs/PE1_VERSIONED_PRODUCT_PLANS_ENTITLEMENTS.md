# IRON-PE1 — Versioned Product Plans + Entitlements

Data: 05/09/2026  
Baseline funcional: PE0 promovido em `main @ e279fb597c16934143c5058f3ff97c2a6b609d6a`.  
Baseline operacional da branch PE1: `main @ f3685c2564f978127b27cf37039ef6b2fa4ac282`; o tree é idêntico ao PE0 promovido, pois dois commits intermediários de correção removeram integralmente um arquivo `noop` acidental, com diff líquido vazio em relação ao SHA PE0.

## 1. Objetivo

Persistir a definição global e governada de produtos SaaS do IRON FIT, suas versões semânticas e os entitlements de cada versão, sem introduzir ainda assinatura SaaS de academia, resolução runtime, configuração tenant, upgrade/downgrade ou pricing.

PE1 transforma o contrato arquitetural do PE0 em domínio persistente versionado e auditável. A FM Tecnologia governa este catálogo global; uma academia não cria nem altera planos por tenant.

## 2. Separação obrigatória de domínios

`ProductPlan` é o produto SaaS da FM Tecnologia. O `Subscription` já existente continua sendo exclusivamente a assinatura financeira do aluno com a academia. PE1 não altera `Subscription`, `Charge`, gateway, cobrança ou faturamento.

Nenhuma relação `gymId` é criada em `ProductPlan`, `ProductPlanVersion` ou `ProductPlanEntitlement`. A ligação de academia a uma versão de produto pertence ao PE2.

## 3. Modelo persistente

### ProductPlan

Identidade global estável por `code`, independente de nomes comerciais que possam mudar na apresentação. Guarda nome e descrição, mas não contém preço nem configuração tenant.

### ProductPlanVersion

Versão inteira positiva ligada a um ProductPlan. A identidade semântica continua sendo `planCode + version`, conforme PE0. Estados permitidos:

- `DRAFT`: entitlements podem ser definidos;
- `PUBLISHED`: semântica congelada;
- `RETIRED`: versão histórica retirada para novas utilizações, sem apagar referências futuras/históricas.

Uma versão publicada não recebe edição de entitlement. Mudança de capability, limite ou policy exige nova versão.

### ProductPlanEntitlement

Snapshot do entitlement de uma versão para uma `featureKey` canônica. Unicidade física por `(planVersionId, featureKey)`. O `kind` é derivado do catálogo canônico PE0, nunca aceito como autoridade do cliente.

Shape persistente:

- FEATURE → `featureEnabled` obrigatório; demais campos nulos;
- LIMIT → `limitValue` inteiro não negativo obrigatório; demais campos nulos;
- POLICY → `policyValues` não vazio, sem duplicação e subconjunto dos valores permitidos no catálogo PE0; demais campos nulos.

A migration adiciona CHECK constraints para versão positiva e shape dos entitlements.

## 4. Publicação e imutabilidade

Somente versões `DRAFT` podem receber upsert de entitlements. Publicar valida novamente todos os registros persistidos contra `PRODUCT_FEATURE_CATALOG_V1` e muda o estado para `PUBLISHED` dentro de transação Serializable com auditoria atômica.

Republicar uma versão já `PUBLISHED` é idempotente. Versão `RETIRED` não pode ser republicada. Retirada só é permitida a partir de `PUBLISHED` e não altera os entitlements congelados.

PE1 admite plano publicado esparso: capability ausente não é concessão implícita. O resolvedor fail-closed do PE2 deverá resolver ausência conforme o default canônico do PE0 (`false`, `0` ou `null`).

## 5. Governança e API

Todos os endpoints PE1 são protegidos por JWT + RolesGuard e restritos a `SUPER_ADMIN`, representando a governança global da FM Tecnologia:

- `GET /product-entitlements/plans`
- `POST /product-entitlements/plans`
- `POST /product-entitlements/plans/:planId/versions`
- `PUT /product-entitlements/plans/:planId/versions/:version/entitlements`
- `POST /product-entitlements/plans/:planId/versions/:version/publish`
- `POST /product-entitlements/plans/:planId/versions/:version/retire`

Não existe `gymId` nos DTOs ou rotas PE1. Não há endpoint tenant para escolher plano nesta fase.

## 6. Concorrência, idempotência e auditoria

Mutações usam transação `Serializable`, retry limitado para conflitos de serialização/unicidade e constraints físicas no banco.

Criação do mesmo `ProductPlan.code` com a mesma definição é idempotente; definição diferente falha com conflito. Criação da mesma `(productPlanId, version)` é idempotente. Upsert de entitlement usa a chave única física.

AuditLog global usa `gymId = null` e registra criação de plano, criação de versão, criação/alteração de entitlement, publicação e retirada.

## 7. Fail-closed e catálogo canônico

Feature key desconhecida é rejeitada. O cliente não escolhe `kind`. O serviço deriva o tipo de `PRODUCT_FEATURE_CATALOG_V1`, valida shape e, em POLICY, valida exclusivamente valores canônicos autorizados pelo PE0.

Nomes comerciais de plano nunca são usados para autorizar módulo. PE1 persiste contratos; PE2 será responsável por resolver capabilities efetivas.

## 8. Fora de escopo

PE1 não implementa:

- assinatura SaaS de academia;
- preço, cobrança ou gateway da FM Tecnologia;
- resolvedor runtime de feature/limit/policy;
- configuração de academia ou preferência de aluno;
- upgrade/downgrade/trial/add-on;
- Creator Network;
- IA;
- alteração de `Exercise.videoUrl`.

## 9. Migration

Migration aditiva: `20260905114500_versioned_product_plans_entitlements`.

Cria somente os enums e tabelas PE1, índices, FKs e CHECK constraints. Nenhuma tabela financeira, tenant ou legado é removida/modificada.

## 10. Critério de saída

PE1 somente pode ser considerado tecnicamente verde quando Prisma generate, lint/typecheck, build, npm audit high e regressão completa estiverem verdes; os testes PE1 devem provar separação de `Subscription`, ausência de `gymId`, governança SUPER_ADMIN, validação canônica, imutabilidade pós-publicação, constraints da migration, idempotência e ausência de resolução PE2 antecipada.
