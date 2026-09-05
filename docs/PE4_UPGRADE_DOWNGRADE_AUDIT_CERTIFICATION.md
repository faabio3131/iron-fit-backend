# IRON-PE4 — Upgrade/Downgrade/Audit + Full Certification

Data: 05/09/2026  
Baseline: `main @ 1e026d975ce00a1521b4ea89ca944dac6f7d05df`.

## 1. Objetivo

Fechar a Fase D — IRON PRODUCT CONFIGURATION & ENTITLEMENTS com transição governada de assinatura SaaS entre versões de ProductPlan e certificação integral PE0-PE4.

O domínio tratado aqui é exclusivamente `TenantProductSubscription`. O modelo `Subscription` financeiro do aluno permanece fisicamente e semanticamente separado.

## 2. Transição de plano

A operação canônica é `POST /product-entitlements/tenant-subscriptions/transition`, restrita a `SUPER_ADMIN`.

A solicitação contém:

- `gymId`: tenant comercial alvo administrado pela FM Tecnologia;
- `expectedCurrentSubscriptionId`: optimistic concurrency token obrigatório;
- `planCode` + `version`: versão alvo exata;
- `transitionKind`: `UPGRADE`, `DOWNGRADE` ou `PLAN_CHANGE`, usado para proveniência/auditoria e não como ranking comercial inventado;
- `reason`: justificativa auditável.

O sistema não infere qual plano é “maior” ou “menor” por nome, preço ou código. PE0 proíbe acoplamento a nomes comerciais e pricing não faz parte desta fase.

## 3. Invariantes

A transição somente ocorre quando cumulativamente:

1. a academia existe e está ativa;
2. há exatamente uma assinatura SaaS ACTIVE efetiva;
3. a versão alvo existe;
4. a versão alvo está `PUBLISHED`;
5. `expectedCurrentSubscriptionId` corresponde à assinatura ACTIVE observada, exceto no replay idempotente para o mesmo alvo;
6. a transação fecha a assinatura anterior antes de criar a nova ACTIVE;
7. o índice parcial físico `TenantProductSubscription_one_active_per_gym` continua sendo a última barreira contra duas assinaturas ACTIVE simultâneas.

A assinatura anterior é preservada como histórico `CANCELED`, com `effectiveUntil`. A nova assinatura recebe novo ID e `effectiveFrom` igual ao encerramento da anterior. Nenhum registro histórico é sobrescrito para fingir que a academia sempre esteve no plano novo.

## 4. Concorrência e idempotência

A operação roda em transação `Serializable` e repete conflitos Prisma `P2034/P2002` até três tentativas.

`expectedCurrentSubscriptionId` impede que duas decisões concorrentes baseadas no mesmo snapshot sejam aplicadas em sequência silenciosamente para alvos diferentes. Se outro processo já mudou a assinatura, uma segunda intenção para alvo diferente falha e exige recarregar o estado.

Replay para o mesmo `planVersionId` já ACTIVE retorna `changed=false` e `idempotent=true`, sem criar nova assinatura e sem AuditLog duplicado.

## 5. Upgrade e downgrade

Upgrade e downgrade são tratados pelo mesmo mecanismo de troca atômica. A direção informada é metadado de negócio para auditoria; a autoridade técnica vem do `ProductPlanVersion` alvo e de seus entitlements versionados.

Somente versões `PUBLISHED` podem receber nova transição. Uma versão `RETIRED` continua válida para um contrato ACTIVE histórico já existente, conforme PE1/PE2, mas não pode ser escolhida como novo alvo.

## 6. Revalidação das camadas PE3

PE4 não apaga nem reescreve `TenantProductConfiguration` ou `UserProductPreference` durante uma troca de plano.

Após a transição, o resolvedor PE3 avalia as configurações existentes contra a nova autoridade superior:

- configuração ainda compatível continua válida;
- FEATURE que tente habilitar direito removido falha fechada;
- LIMIT acima do novo teto falha fechado;
- POLICY fora do novo conjunto falha fechada;
- preferência de usuário que exceda a configuração/novo plano também falha fechada.

Isso preserva histórico e evita que downgrade provoque ampliação acidental ou limpeza destrutiva silenciosa.

## 7. Auditoria

Toda transição efetiva registra `TENANT_PRODUCT_SUBSCRIPTION_TRANSITIONED` atomicamente na mesma transação.

O AuditLog contém snapshot anterior e posterior, incluindo:

- IDs das assinaturas;
- gymId;
- planCode e version;
- status e janela de vigência;
- `transitionKind`;
- `reason`;
- vínculo `previousSubscriptionId` no estado novo.

Replay idempotente para o alvo já ativo não gera auditoria falsa.

## 8. Segurança e autoridade

A transição é operação de governança comercial global, portanto permanece `SUPER_ADMIN`-only, em coerência com a atribuição inicial PE2 e com a governança global de ProductPlan PE1.

OWNER/MANAGER continuam autorizados apenas a estreitar a experiência dentro do entitlement contratado via PE3. Eles não escolhem unilateralmente uma nova versão comercial nesta fase.

## 9. Migration

PE4 não requer nova migration. O PE2 já criou:

- histórico de múltiplas `TenantProductSubscription` por academia;
- `effectiveFrom` / `effectiveUntil`;
- status de ciclo de vida;
- índice parcial único que permite no máximo uma assinatura `ACTIVE` por gym.

Criar outra estrutura persistente seria redundante e aumentaria o domínio sem necessidade.

## 10. Fora de escopo

PE4 não implementa pricing, cobrança SaaS, invoice, gateway, trial comercial, add-ons, cupom, proration, refund, Creator Network ou IA. Também não altera `Subscription`, `Charge` ou qualquer fluxo financeiro do aluno.

## 11. Certificação PE0-PE4

A saída da Fase D exige regressão completa e permanente comprovando conjuntamente:

- catálogo canônico FEATURE/LIMIT/POLICY e precedência PE0;
- planos/versionamento/imutabilidade PE1;
- assinatura tenant e resolvedor fail-closed PE2;
- configuração tenant e preferência do aluno monotônicas PE3;
- transição atômica/idempotente/otimista PE4;
- isolamento Gym A/Gym B;
- ausência de acoplamento a nomes comerciais de planos;
- separação física e semântica do `Subscription` financeiro do aluno;
- npm audit high, Prisma generate, lint/typecheck, build e smoke regression sem teste crítico skipped.

Somente após todos os gates verdes a Fase D pode ser marcada como CERTIFICADA e a Fase E — FITNESS CREATOR NETWORK / IRON-CN0 pode ser liberada.
