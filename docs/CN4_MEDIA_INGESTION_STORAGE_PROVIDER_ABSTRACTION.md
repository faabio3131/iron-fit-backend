# IRON-CN4 — Media Ingestion + Storage/CDN/Provider Abstraction

Data: 05/09/2026  
Baseline: `main @ 0a3c294166f085a987808863c75b25b39b25e2be`

## 1. Objetivo e fronteira

CN4 materializa exclusivamente `media.ingestion_delivery`: o caminho governado entre o Media Asset lógico do CN3 e um objeto físico verificado em storage, com abstração explícita de provider e resolução de delivery sem acoplamento do domínio a S3, R2, Cloudflare, CDN ou outro fornecedor específico.

CN4 não escolhe um fornecedor sem configuração/homologação, não inventa endpoints, credenciais, buckets, regions, URLs, regras de assinatura ou contratos externos. Se não existir adapter registrado e `IRON_MEDIA_PROVIDER_CODE` configurado, o runtime falha fechado.

Continuam fora deste bloco:

- CN5: Exercise ↔ Content Mapping + Publishing Workflow;
- CN6: moderação, qualidade, versionamento editorial e lifecycle;
- CN7: attribution, usage metering e engagement;
- CN8: regras comerciais, revenue share e settlement;
- CN9: console, analytics e certificação integral.

`Exercise.videoUrl` permanece intacto e `EXTERNAL_REFERENCE` continua fora da ingestão gerenciada.

## 2. Contrato de provider

`CreatorMediaProvider` define somente capacidades que o Core precisa:

1. `prepareUpload` — recebe object key lógico, MIME type e SHA-256 esperado; devolve instrução efêmera de upload;
2. `inspectObject` — comprova existência, tamanho e SHA-256 real do objeto;
3. `resolveDelivery` — devolve referência efêmera HTTPS de entrega.

O contrato não contém endpoint fixo, segredo, bucket, região, token, vendor SDK ou política comercial. Adapters concretos futuros são responsáveis por traduzir essas operações para APIs oficialmente homologadas.

`CreatorMediaProviderRegistry` registra adapters explicitamente. A seleção padrão é server-side por `IRON_MEDIA_PROVIDER_CODE`; tenant e request body não escolhem provider de infraestrutura.

## 3. Ingestão persistente

`CreatorMediaIngestion` registra a tentativa governada de materializar um `CreatorMediaAsset`:

- `mediaAssetId`;
- `providerCode`;
- `objectKey` lógico/determinístico;
- `requestKey` do comando idempotente;
- `fingerprint` determinístico;
- estado técnico `PREPARED | VERIFIED | FAILED`;
- failure code governado quando houver falha;
- timestamps de preparação, verificação e falha.

`requestKey` é único por asset. Um request já `FAILED` não é reanimado silenciosamente; nova intenção exige nova request key. Um asset já verificado no provider configurado não cria nova ingestão desnecessária.

Os failure codes deste bloco são estritamente técnicos:

- `PROVIDER_PREPARE_FAILED`;
- `PROVIDER_INSPECTION_FAILED`;
- `OBJECT_NOT_FOUND`;
- `INTEGRITY_HASH_UNAVAILABLE`;
- `INTEGRITY_MISMATCH`;
- `INVALID_OBJECT_SIZE`.

Eles não representam moderação, publishing ou lifecycle editorial do CN6.

## 4. Storage object verificado

`CreatorMediaStorageObject` somente nasce após `inspectObject` comprovar:

- objeto existente;
- SHA-256 real verificável;
- SHA-256 idêntico a `CreatorMediaAsset.integritySha256` do CN3;
- tamanho positivo.

Registra apenas:

- asset;
- ingestion de origem;
- provider code;
- object key;
- hash comprovado;
- tamanho;
- ETag opcional;
- timestamp de verificação.

A unicidade `(mediaAssetId, providerCode)` impede múltiplas identidades físicas concorrentes do mesmo asset no mesmo provider neste bloco. `(providerCode, objectKey)` também é único.

URL de upload, URL de delivery, headers temporários, credenciais e tokens nunca são persistidos.

## 5. Segurança e escopo

As rotas CN4 usam os mesmos contextos governados dos blocos anteriores:

- `GLOBAL`: somente `SUPER_ADMIN`, `gymId = null`;
- `TENANT`: somente `OWNER/MANAGER`, tenant derivado de `activeGymId` autenticado;
- `SUPER_ADMIN` global não usa a rota tenant como impersonation;
- nenhum DTO aceita `gymId` ou `providerCode`.

Toda leitura de asset/ingestion/storage valida o escopo do `CreatorContent` pai. Tenant A nunca prepara, verifica ou resolve mídia do tenant B.

## 6. Direitos continuam vivos

CN4 reavalia Rights Vault CN2 antes de preparar ingestão, antes de promover um objeto para storage verificado e antes de resolver delivery.

A operação falha fechada se:

- grant não pertence ao mesmo escopo/tenant/relation kind;
- não existe versão `ACTIVE`;
- rights holder não está `ACTIVE`;
- janela de validade ainda não começou ou expirou;
- consentimento obrigatório não está `ACTIVE` e vigente.

O fato de um objeto continuar fisicamente armazenado após expiração/revogação não autoriza delivery. Remoção física, retenção e lifecycle posterior não são inventados neste bloco.

## 7. Prepare de upload

Endpoint administrativo:

`POST /creator-network/media/:scope/items/:contentId/assets/:assetId/ingestions`

Body: apenas `requestKey` UUID.

O serviço:

1. resolve provider configurado no servidor;
2. valida tenant e asset;
3. revalida rights;
4. verifica storage já existente;
5. cria/reusa ingestão `PREPARED` idempotente;
6. solicita ao adapter uma instrução efêmera;
7. aceita somente URL HTTPS e expiração futura;
8. retorna a instrução sem persistir URL/headers.

Falha do adapter é sanitizada, registrada como `PROVIDER_PREPARE_FAILED` e não cria falsa evidência de storage.

## 8. Verify de ingestão

Endpoint administrativo:

`POST /creator-network/media/:scope/items/:contentId/assets/:assetId/ingestions/:ingestionId/verify`

A verificação consulta o provider pelo `providerCode` persistido na ingestão. O provider deve comprovar SHA-256 real; ETag sozinho não substitui SHA-256.

Falhas de existência/integridade/tamanho ficam persistidas e auditadas. Somente depois da inspeção externa válida o serviço abre transação serializável, revalida escopo + rights e cria `CreatorMediaStorageObject` + marca a ingestão `VERIFIED` atomicamente.

## 9. Delivery provider-neutral

Endpoint administrativo:

`GET /creator-network/media/:scope/items/:contentId/assets/:assetId/delivery`

CN4 não publica conteúdo nem decide qual asset um aluno pode consumir. O endpoint apenas comprova a abstração de delivery do asset explicitamente indicado para operações administrativas/downstream.

Antes de pedir URL ao adapter, o serviço revalida rights e exige storage verificado no provider configurado. A resposta do adapter deve ser HTTPS e, se possuir expiração, ela precisa estar no futuro. A URL é efêmera e não é gravada no banco.

O resolvedor público/aluno, precedência de conteúdo canônico e fallback `Exercise.videoUrl` pertencem ao CN5+ conforme a arquitetura.

## 10. Concorrência, idempotência e auditoria

Mutações persistentes usam `Serializable` + retry controlado de `P2034/P2002`.

Eventos:

- `MEDIA_INGESTION_PREPARED`;
- `MEDIA_INGESTION_FAILED`;
- `MEDIA_INGESTION_VERIFIED`.

AuditLog não registra upload URL, delivery URL, headers, credenciais ou erro bruto do provider.

## 11. Migration

Migration CN4: `20260905160000_media_ingestion_storage_provider_abstraction`.

É aditiva e cria apenas:

- `CreatorMediaIngestionStatus`;
- `CreatorMediaIngestionFailure`;
- `CreatorMediaIngestion`;
- `CreatorMediaStorageObject`;
- constraints, índices e FKs correspondentes.

Não altera Exercise, Equipment, ProductPlan, Subscription/Charge, Aggregator, direitos jurídicos CN2 ou catálogo semântico CN3 além das relações aditivas necessárias em Prisma.

## 12. Provider live — pendência externa legítima

Nenhum provider de storage/CDN foi selecionado, contratado, credenciado ou homologado neste repositório até este bloco. Portanto CN4 entrega o Core e o contrato de adapter completos, mas a ativação de ingestão/delivery live requer decisão/configuração externa posterior:

- provider oficial;
- credenciais/segredos via infraestrutura segura;
- bucket/container/region/namespace oficiais;
- APIs e checksum semantics homologados;
- política de CDN/signed delivery;
- limites, retries, expiração e observabilidade do provider.

Até isso existir, o registry falha fechado. Essa pendência não autoriza fallback fake, URL inventada ou armazenamento local silencioso em produção.

## 13. Fronteira CN5-CN9

CN4 não cria:

- `exerciseId` ou relação Exercise ↔ Content;
- status `PUBLISHED`, publish/unpublish ou seleção de conteúdo;
- moderação/quality score/lifecycle editorial;
- views/clicks/engagement;
- revenue share/payout/settlement;
- console/analytics;
- IA para inferir metadata, direitos ou provider.

## 14. Critério de saída

CN4 somente pode ser promovido quando:

- Prisma/migration reconhecerem ingestão e storage verificado;
- provider abstraction não contiver endpoint/credencial/vendor inventado;
- provider ausente/não homologado falhar fechado;
- tenant isolation e RBAC estiverem preservados;
- request body não controlar tenant nem provider;
- rights forem reavaliados em prepare, verify e delivery;
- storage só nascer após SHA-256 real == SHA-256 canônico;
- upload/delivery URLs não forem persistidos/auditados;
- idempotência e concorrência estiverem protegidas;
- CN5-CN9 e `Exercise.videoUrl` permanecerem fora do diff;
- npm audit high, Prisma generate, lint/typecheck, build e regressão completa estiverem verdes, sem testes críticos skipped.
