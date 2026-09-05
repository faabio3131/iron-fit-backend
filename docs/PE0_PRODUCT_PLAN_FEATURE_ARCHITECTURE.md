# IRON-PE0 — Product / Plan / Feature Architecture

Data: 05/09/2026  
Baseline: `main @ bb931d1e525babbb7c32bfbff1aa88b261d7114a`

## 1. Objetivo

Criar a fundação arquitetural transversal para configuração comercial do IRON FIT sem introduzir persistência de planos nesta etapa. A FM Tecnologia deve poder versionar produtos e capacidades; a academia deve poder configurar a experiência dos alunos somente dentro daquilo que seu contrato/plano autoriza; e os módulos do SaaS devem depender de chaves canônicas de capability, não de nomes comerciais ou `if (plan === ...)` espalhados pelo código.

PE0 define contratos, terminologia, precedência e catálogo inicial de capabilities. Persistência, APIs administrativas e resolvedor operacional pertencem aos blocos PE1-PE4.

## 2. Domínios que NÃO devem ser confundidos

O modelo `Subscription` já existente no IRON é uma assinatura financeira do aluno com a academia. Ele não representa a assinatura SaaS da academia com a FM Tecnologia.

A arquitetura PE usa explicitamente dois domínios distintos:

- `IRON_PRODUCT_PLAN`: produto/plano SaaS da FM Tecnologia para uma academia;
- `STUDENT_FINANCIAL_SUBSCRIPTION`: assinatura financeira do aluno dentro da academia.

Nenhuma migration é criada em PE0. O domínio persistente de ProductPlan/PlanVersion/Entitlement/Tenant SaaS Subscription pertence ao PE1/PE2.

## 3. Tipos canônicos de entitlement

### FEATURE

Capacidade booleana. O padrão fail-closed é `false`. Uma camada inferior pode desligar algo permitido acima, mas nunca ligar algo negado acima.

### LIMIT

Limite numérico superior. O padrão fail-closed é `0`. Uma camada inferior pode reduzir o limite, mas nunca exceder o concedido pelo plano.

### POLICY

Conjunto de escolhas/políticas permitidas. O padrão fail-closed é `null`. Uma camada inferior pode escolher/subdividir apenas valores autorizados pela camada superior.

## 4. Precedência obrigatória

A autoridade é monotônica e somente pode estreitar permissões:

1. `IRON_POLICY`
2. `PLAN_ENTITLEMENT`
3. `TENANT_CONFIGURATION`
4. `USER_PREFERENCE`

A camada inferior nunca amplia autoridade da camada superior. Isso vale para rotas, serviços e UX; o backend é a autoridade final.

## 5. Feature keys

Feature keys são namespaced, estáveis e independentes de nomes comerciais de plano. Exemplos da primeira taxonomia:

- `content.external_youtube`
- `content.iron_managed`
- `content.tenant_private`
- `content.private_items_max`
- `content.delivery_mode`
- `equipment.catalog`
- `equipment.inventory`
- `aggregator.wellhub`
- `aggregator.totalpass`
- `analytics.aggregator`
- `ai.workout_generation`
- `ai.content_recommendation`

Os nomes `Start`, `Pro`, `Premium`, `Enterprise` ou qualquer outro futuro nome comercial NÃO são contratos de domínio. Um módulo pergunta por capability, não pelo nome do plano.

## 6. Versionamento comercial

PE0 fixa a referência `planCode + version` como identidade semântica de uma versão de produto. Uma versão publicada não deve ter sua semântica alterada silenciosamente. Mudanças de capabilities, limites ou políticas comerciais relevantes geram nova versão no PE1.

Isso permite grandfathering, upgrade, downgrade, trial, add-ons e contratos especiais posteriormente sem alterar retroativamente o que um cliente contratou.

## 7. Creator Network e Launch Bridge

A Creator Network consumirá esta fundação. O lançamento inicial do IRON deve continuar podendo oferecer o comportamento simples já existente: aluno clica em “ver execução” e é direcionado ao YouTube.

A capability `content.external_youtube` representa essa permissão comercial. `content.delivery_mode` define o espaço canônico de políticas configuráveis que poderá ser operacionalizado nos blocos posteriores.

Durante a migração da Creator Network:

1. conteúdo canônico publicado, quando existente e permitido, terá precedência;
2. `Exercise.videoUrl` permanece fallback compatível;
3. ausência de ambos não autoriza o sistema a inventar conteúdo;
4. link público externo é `EXTERNAL_REFERENCE`, não prova licença, propriedade ou direito comercial;
5. remoção do `videoUrl` legado somente poderá ocorrer em bloco próprio com migração e certificação.

PE0 não altera `Exercise.videoUrl`.

## 8. Catálogo inicial não é pricing

`PRODUCT_FEATURE_CATALOG_V1` é um catálogo técnico inicial de capabilities e não define preço, pacote, plano comercial ou entitlement efetivo de qualquer academia. PE1 definirá planos/versionamento; PE2 resolverá assinatura SaaS e entitlement efetivo; PE3 aplicará configuração tenant/student experience; PE4 tratará mudança de plano, auditoria e certificação.

## 9. Fail-closed

Feature desconhecida ou sem entitlement resolvido não pode ser considerada habilitada. Limite desconhecido resolve conceitualmente para zero. Policy desconhecida não seleciona um valor automaticamente.

O resolvedor runtime definitivo será implementado somente no PE2, mas deve respeitar estes invariantes sem exceção.

## 10. Segurança e isolamento

- tenant nunca escolhe ou altera o plano efetivo enviando `gymId`, `planCode` ou entitlement arbitrário em uma operação de domínio;
- FM Tecnologia governa catálogo de produtos e versões;
- OWNER/MANAGER governa somente configuração do tenant dentro dos entitlements efetivos;
- preferências de aluno apenas estreitam a experiência permitida;
- nenhuma feature flag substitui RBAC, tenant isolation, direitos autorais, eligibility, financial invariants ou outras políticas obrigatórias do Core.

## 11. Escopo PE0

Incluído:

- arquitetura Product/Plan/Feature;
- contratos TypeScript canônicos;
- tipos FEATURE/LIMIT/POLICY;
- precedência de configuração;
- taxonomia inicial de feature keys;
- contrato de versionamento;
- Launch Bridge YouTube formalizado;
- testes permanentes de invariantes.

Fora de escopo:

- tabelas/migrations de ProductPlan;
- preços e nomes finais de planos;
- CRUD administrativo;
- assinatura SaaS efetiva de tenant;
- cobrança da FM Tecnologia;
- resolução runtime de entitlements;
- configuração do gestor;
- Creator Network implementation.

## 12. Critério de saída

PE0 somente pode ser aprovado quando lint/typecheck, build, npm audit high e toda a regressão permanente estiverem verdes, sem mudança de schema e sem regressão do `Exercise.videoUrl` legado.
