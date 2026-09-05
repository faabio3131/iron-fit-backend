# IRON-CN3 — Canonical Content Catalog + Media Asset Domain

Data: 05/09/2026  
Baseline: `main @ c8d8a1200e3693b7836044f3574744bf22cacdc3`

## 1. Objetivo e fronteira

CN3 materializa exclusivamente a identidade canônica de conteúdo gerenciado e o domínio lógico de Media Asset definidos no CN0, consumindo a proveniência de direitos criada no CN2.

A identidade de conteúdo é independente de exercício, URL de entrega, storage, CDN, provider, upload e estado de publicação. O Media Asset deste bloco representa somente identidade, integridade e metadados declarados do artefato; CN3 não armazena bytes nem escolhe como eles serão ingeridos ou entregues.

Ficam fora do CN3 e permanecem reservados aos blocos seguintes:

- CN4: ingestão, upload, storage, CDN e abstração de providers;
- CN5: Exercise ↔ Content Mapping e Publishing Workflow;
- CN6: moderação, qualidade, versionamento editorial e lifecycle de conteúdo;
- CN7: attribution runtime, usage metering e engagement;
- CN8: regras comerciais, revenue share e settlement;
- CN9: console, analytics e certificação integral.

`Exercise.videoUrl` não é alterado e continua sendo o Launch Bridge/fallback legado governado pela arquitetura CN0.

## 2. Conteúdo canônico

`CreatorContent` é a identidade estável de um item gerenciado no catálogo. Ele registra:

- `scope`: `GLOBAL | TENANT` reutilizando o contexto canônico de direitos;
- `gymId`: sempre `null` no global e obrigatório no tenant;
- `canonicalKey`: chave estável, normalizada e única dentro do escopo;
- `title` e `description` de catálogo;
- `relationKind`: somente `LICENSED_CONTENT | IRON_OWNED | TENANT_OWNED`;
- `creatorId` opcional, para autoria/associação explícita sem transformar creator em rights holder;
- `rightsGrantId` obrigatório apontando para o grant lógico CN2;
- `fingerprint` determinístico para idempotência de entrada.

CN3 não cria campo `exerciseId`, `videoUrl`, `deliveryUrl`, `storageKey`, `providerId`, `publishedAt`, ranking, moderação ou monetização.

## 3. Escopo e isolamento

O catálogo usa os mesmos dois contextos governados do Rights Vault:

- `GLOBAL`: somente `SUPER_ADMIN`, sem `gymId`;
- `TENANT`: somente `OWNER`/`MANAGER` com academia derivada de `activeGymId` autenticado.

Nenhum DTO aceita `gymId`. Um `SUPER_ADMIN` global não usa a rota tenant como impersonation.

Regras físicas e de serviço:

- conteúdo `TENANT` exige `TENANT_OWNED`;
- `TENANT_OWNED` não pode ser catalogado globalmente;
- tenant A nunca lista, lê ou registra assets de conteúdo do tenant B;
- `canonicalKey` é única globalmente para escopo GLOBAL e única por `(gymId, canonicalKey)` no escopo TENANT.

## 4. Relação com o Rights Vault CN2

Todo conteúdo gerenciado exige `rightsGrantId`. Na entrada, CN3 valida na mesma transação serializável que o grant:

1. pertence ao mesmo `GLOBAL/TENANT` e ao mesmo `gymId`;
2. possui o mesmo `relationKind` do conteúdo;
3. possui versão `ACTIVE`;
4. possui rights holder `ACTIVE`;
5. está dentro da janela de validade;
6. possui consentimento `ACTIVE` e vigente quando `requiresCreatorConsent = true`.

A existência do item no catálogo não congela nem perpetua autorização. CN4/CN5 e qualquer uso posterior continuam obrigados a reavaliar direitos efetivos. Expiração, suspensão ou revogação no CN2 não apagam o fato histórico de que o conteúdo foi catalogado, mas impedem novas operações gerenciadas que exijam direitos válidos.

CN3 não altera grants ou consentimentos e não interpreta documentos jurídicos.

## 5. Creator e autoria

`creatorId` é opcional e representa associação/autoria de catálogo. Novo conteúdo vinculado a um creator exige `Creator ACTIVE` no CN1.

Essa associação não prova titularidade, licença, cessão ou direito comercial. A autoridade de direitos continua exclusivamente no Rights Vault por `rightsGrantId`.

## 6. Media Asset lógico

`CreatorMediaAsset` pertence a um `CreatorContent` e registra somente:

- `kind`: `VIDEO | AUDIO | IMAGE`;
- `integritySha256`: hash SHA-256 do artefato lógico;
- `mimeType` declarado;
- `durationMs` opcional;
- `width` e `height` opcionais;
- `languageCode` opcional;
- timestamps técnicos.

A unicidade `(contentId, integritySha256)` torna a entrada idempotente e evita duplicação do mesmo artefato para o mesmo conteúdo.

O hash é identidade/integridade declarada no CN3. A validação contra bytes realmente ingeridos pertence ao CN4. Não existem neste modelo URL, bucket, object key, CDN, provider, upload session, transcoding, streaming manifest ou credencial.

## 7. Entrada e leitura do catálogo

Rotas do bloco:

- `GET /creator-network/content/:scope/items`;
- `GET /creator-network/content/:scope/items/:contentId`;
- `POST /creator-network/content/:scope/items`;
- `POST /creator-network/content/:scope/items/:contentId/assets`.

As rotas são administrativas/governadas. CN3 não fornece endpoint de consumo do aluno, publicação ou entrega de mídia.

`canonicalKey` repetida com a mesma definição é idempotente. A mesma chave com definição divergente falha fechada. Um asset com o mesmo `(contentId, integritySha256)` e os mesmos metadados é idempotente; divergência de metadados para o mesmo hash falha fechada.

## 8. Concorrência e auditoria

Mutações usam `Serializable` com retry controlado para `P2034/P2002` e AuditLog na mesma transação.

Eventos mínimos:

- `CONTENT_CATALOG_ITEM_REGISTERED`;
- `CONTENT_MEDIA_ASSET_REGISTERED`.

AuditLog registra IDs, escopo, relation kind, hash do asset e a versão de direitos efetiva observada na entrada. Não registra bytes, documentos jurídicos ou segredos de storage/provider.

## 9. Migration e constraints

Migration CN3: `20260905153500_canonical_content_catalog_media_asset`.

É aditiva e cria somente:

- enum `CreatorMediaAssetKind`;
- tabela `CreatorContent`;
- tabela `CreatorMediaAsset`;
- índices, checks e FKs necessários.

Constraints protegem:

- coerência `GLOBAL/TENANT` x `gymId`;
- coerência de `relationKind` por escopo;
- formato da `canonicalKey`;
- título não vazio;
- SHA-256 de asset;
- metadados numéricos positivos e limitados;
- unicidade canônica por escopo;
- unicidade de asset por conteúdo + hash;
- FKs `RESTRICT` para preservar proveniência e histórico.

Nenhuma tabela de Exercise, Equipment, ProductPlan, Subscription/Charge, Aggregator ou domínios financeiros é alterada.

## 10. Fronteiras CN4-CN9

CN3 não contém nem antecipa:

- upload, ingestão ou storage;
- CDN, provider adapter ou URL de entrega;
- `Exercise` ↔ `CreatorContent` relation;
- `PUBLISHED`, publish/unpublish ou resolvedor de publicação;
- moderação, quality score, aprovação editorial ou lifecycle CN6;
- views, clicks, engagement ou usage meter;
- revenue share, payout ou settlement;
- IA para inferir direitos, conteúdo ou metadados.

`EXTERNAL_REFERENCE` continua fora do catálogo gerenciado CN3 e permanece no Launch Bridge CN0. Um link público não pode ser transformado silenciosamente em `CreatorContent` gerenciado.

## 11. Critério de saída

CN3 somente pode ser promovido quando:

- Prisma generate reconhecer `CreatorContent` e `CreatorMediaAsset`;
- migration estiver alinhada e aditiva;
- isolamento GLOBAL/TENANT e RBAC estiverem comprovados;
- managed content exigir Rights Grant CN2 coerente e efetivo na entrada;
- idempotência de conteúdo e asset estiver protegida;
- Media Asset permanecer independente de URL/storage/provider;
- Exercise mapping, publishing, ingestão, moderação, metering, settlement e IA permanecerem fora do diff;
- `Exercise.videoUrl` permanecer intacto;
- npm audit high, lint/typecheck, build e regressão completa estiverem verdes, sem testes críticos skipped.
