# IRON-CN0 — Creator Network Architecture + Rights/Business Capability Map

Data: 05/09/2026  
Baseline canônica: `main @ 7ca0bbfdd0ebe23727e73ce45710d5b39810d90b`

## 1. Objetivo e limite do bloco

IRON-CN0 define exclusivamente a arquitetura, a linguagem de direitos e o capability map de negócio da Fitness Creator Network. Este bloco cria contratos canônicos e documentação de governança para orientar CN1-CN9, sem antecipar persistência, migrations, endpoints de produção, Creator Registry, Rights Vault, catálogo persistente, ingestão de mídia, CDN, publishing workflow, moderação, metering, settlement ou console operacional.

A Creator Network deve evoluir sobre as fundações já certificadas do Core, Equipment Catalog e Product Configuration & Entitlements. CN0 não modifica `Subscription` financeiro do aluno, ProductPlan/entitlements SaaS, pricing, gateway, IA ou o comportamento legado de `Exercise.videoUrl`.

## 2. Relações canônicas entre conteúdo e direitos

A identidade do conteúdo, a autoria, o direito de uso e o modo de entrega são conceitos distintos. CN0 define quatro relações semânticas:

### `EXTERNAL_REFERENCE`

Referência para conteúdo hospedado por terceiro, como um link público de YouTube. A existência pública do link não prova licença, cessão, titularidade, autorização comercial, permissão de cópia, rehosting ou exploração pelo IRON. O IRON pode apontar para a referência quando permitido pelo produto e pelas políticas aplicáveis, sem declarar propriedade do conteúdo.

### `LICENSED_CONTENT`

Conteúdo de terceiro cuja utilização pelo IRON depende de evidência de licença/consentimento válida, com titular, escopo, território, validade, condições de atribuição e revogação rastreáveis. Conteúdo licenciado é conteúdo gerenciado e exige proveniência de direitos antes de hospedagem/publicação.

### `IRON_OWNED`

Conteúdo cuja titularidade patrimonial aplicável pertence ao IRON/FM Tecnologia ou foi validamente transferida para essa finalidade. Também exige proveniência documental da cadeia de direitos; o simples fato de o conteúdo ter sido produzido para o IRON não substitui a prova de titularidade aplicável.

### `TENANT_OWNED`

Conteúdo que uma academia/tenant declara possuir ou estar autorizada a explorar. A declaração do tenant não amplia automaticamente direitos. Conteúdo privado/tenant-managed deve ser tenant-scoped e sujeito a evidência, responsabilidade e regras definidas nos blocos posteriores.

Regra estrutural: `EXTERNAL_REFERENCE` não pode ser promovido silenciosamente para qualquer classe de conteúdo gerenciado. `LICENSED_CONTENT`, `IRON_OWNED` e `TENANT_OWNED` exigem proveniência de direitos antes de o IRON hospedar ou publicar mídia sob seu controle.

## 3. Dimensões mínimas do Rights Model

CN2 deverá materializar um Rights Vault capaz de representar, sem reduzir a decisão a um simples booleano:

- `RIGHTS_HOLDER` — titular ou entidade que concede o direito;
- `LICENSE_BASIS` — contrato, licença, cessão, consentimento ou outra base válida;
- `USAGE_SCOPE` — usos permitidos e proibidos;
- `DELIVERY_SCOPE` — referência externa, streaming, download, embed, distribuição privada ou outros modos autorizados;
- `TERRITORY` — países/regiões aplicáveis;
- `VALIDITY_WINDOW` — início, término e condições temporais;
- `REVOCATION_STATUS` — estado de revogação/suspensão e efeitos;
- `ATTRIBUTION_REQUIREMENT` — créditos obrigatórios e forma de atribuição.

Autor do vídeo, creator, uploader, rights holder e beneficiário comercial podem ser pessoas/entidades diferentes. Identidade de creator nunca é, isoladamente, prova de titularidade.

## 4. Capability map canônico CN0-CN9

| Bloco | Capability canônica | Responsabilidade |
|---|---|---|
| CN0 | `launch_bridge.external_reference` | Preservar o Launch Bridge e fixar taxonomia, fronteiras e regras de direitos. |
| CN1 | `creator.identity_governance` | Creator Registry, identidade, status e governança. |
| CN2 | `rights.license_consent_vault` | Rights Vault, licensing, consent, titularidade e proveniência. |
| CN3 | `content.canonical_catalog` | Catálogo canônico de conteúdo e domínio de Media Asset. |
| CN4 | `media.ingestion_delivery` | Ingestão, storage, CDN e abstração de providers. |
| CN5 | `content.exercise_mapping_publishing` | Mapeamento Exercise ↔ Content e publishing workflow. |
| CN6 | `content.moderation_lifecycle` | Moderação, qualidade, versionamento e lifecycle. |
| CN7 | `content.attribution_usage_engagement` | Atribuição, usage metering e engagement events. |
| CN8 | `creator.commercial_settlement` | Regras comerciais, revenue share e settlement de creators. |
| CN9 | `creator.operations_analytics_certification` | Console operacional, analytics e certificação integral. |

Cada bloco posterior só pode materializar a responsabilidade que lhe pertence. O capability map é um contrato de fronteira, não autorização para antecipar funcionalidades.

## 5. Launch Bridge obrigatório e migração segura

O lançamento simples já aprovado continua parte oficial da arquitetura:

1. quando existir conteúdo canônico `PUBLISHED`, elegível, com direitos válidos e permitido pelos entitlements/políticas efetivos, o resolvedor futuro poderá priorizá-lo conforme `content.delivery_mode`;
2. quando não existir conteúdo canônico elegível, `Exercise.videoUrl` permanece fallback compatível quando `content.external_youtube` estiver efetivamente permitido;
3. ausência de conteúdo canônico e de fallback válido não autoriza criação, geração ou inferência de URL/conteúdo;
4. um link público externo permanece `EXTERNAL_REFERENCE` e não implica licença, propriedade ou direito de exploração comercial;
5. a retirada futura de `Exercise.videoUrl` exige bloco próprio, migration quando aplicável, plano de compatibilidade e certificação completa.

CN0 não altera `Exercise.videoUrl`, não troca links existentes e não cria lógica runtime de seleção de conteúdo.

## 6. Integração com Product Configuration & Entitlements

A Creator Network consome o resolvedor canônico PE0-PE4 e não consulta nomes comerciais de planos. As capabilities de produto já existentes relevantes são:

- `content.external_youtube` — FEATURE;
- `content.iron_managed` — FEATURE;
- `content.tenant_private` — FEATURE;
- `content.private_items_max` — LIMIT;
- `content.delivery_mode` — POLICY.

A precedência continua `IRON_POLICY > PLAN_ENTITLEMENT > TENANT_CONFIGURATION > USER_PREFERENCE`; uma camada inferior nunca amplia a autoridade superior. Habilitar comercialmente uma capability não substitui RBAC, tenant isolation, prova de direitos, moderação ou outras políticas obrigatórias.

CN0 não cria novos preços, pacotes, ProductPlanVersions, subscriptions SaaS, cobranças, add-ons ou gateways.

## 7. Segurança, multi-tenant e fail-closed

- tenant é derivado da identidade autenticada quando houver operação tenant-scoped;
- tenant A nunca acessa conteúdo privado, direitos ou configurações do tenant B;
- nenhuma academia pode converter um link externo em conteúdo gerenciado global apenas por enviar URL/metadados;
- managed content sem proveniência suficiente de direitos deve falhar fechado para hospedagem/publicação;
- expiração, revogação ou incompatibilidade de escopo de direitos devem impedir uso gerenciado nos blocos runtime posteriores;
- atribuição, view, click, engagement ou popularidade não provam titularidade ou licença;
- IA não pode inventar direitos, consentimentos, licenças ou ownership.

## 8. Separação dos domínios comerciais e financeiros

`creator.commercial_settlement` pertence ao CN8 e representa eventual remuneração/revenue share de creators. Ele é semanticamente separado de:

- `STUDENT_FINANCIAL_SUBSCRIPTION` — relação financeira aluno ↔ academia;
- `IRON_PRODUCT_PLAN` — relação SaaS academia ↔ FM Tecnologia;
- gateways/cobranças já existentes do produto.

CN0 não define fórmula de revenue share, preço, comissão, payout, moeda, gateway ou obrigação financeira. Esses elementos exigem bloco próprio e regras auditáveis quando CN8 for executado.

## 9. Proveniência, auditabilidade e lifecycle

A arquitetura futura deve preservar cadeia de proveniência suficiente para responder: quem forneceu o conteúdo, quem é o creator, quem é o rights holder, qual base autorizou o uso, quando foi válida, onde pode ser entregue, qual versão foi publicada, quem aprovou e quando houve suspensão/revogação.

Mudanças de direitos não devem apagar fatos históricos. Conteúdo retirado, licença revogada e versões antigas devem permanecer rastreáveis conforme políticas de retenção, segurança e LGPD que serão materializadas nos blocos correspondentes.

## 10. O que CN0 não faz

Fora de escopo de CN0:

- Prisma models ou migrations;
- tabelas de creators, rights, assets, licenses ou settlements;
- endpoints/controller/service runtime da Creator Network;
- upload/ingestão de mídia;
- escolha ou integração de storage/CDN/provider;
- moderação operacional;
- publishing de conteúdo;
- tracking de views/engagement;
- revenue share/settlement;
- remoção ou migração de `Exercise.videoUrl`;
- pricing, gateway ou alteração do financeiro do aluno;
- uso de IA para decisão de direitos.

## 11. Critério de saída

CN0 somente pode ser aprovado quando:

- o contrato TypeScript e esta arquitetura forem consistentes;
- as quatro relações de conteúdo permanecerem semanticamente distintas;
- managed content exigir proveniência de direitos;
- o capability map cobrir CN0-CN9 sem sobreposição de responsabilidade;
- o Launch Bridge e `Exercise.videoUrl` permanecerem preservados;
- a integração com PE0-PE4 continuar fail-closed e independente de nomes comerciais de planos;
- não houver migration/schema/runtime antecipado;
- lint/typecheck, build, npm audit high e regressão permanente estiverem verdes, sem testes críticos skipped.
