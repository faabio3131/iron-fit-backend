# IRON-CN5 — Exercise ↔ Content Mapping + Publishing Workflow

Data: 05/09/2026  
Baseline: `main @ 3db7bec03ef71621d9a127df448734004625ed47`

## 1. Objetivo e fronteira

CN5 conecta o `Exercise` global existente ao conteúdo canônico CN3, usa a mídia verificada CN4 como artefato de entrega e materializa o workflow mínimo de publicação necessário para o Launch Bridge evoluir sem remover `Exercise.videoUrl`.

CN5 não implementa moderação, quality score, versionamento editorial, aprovação de qualidade ou lifecycle avançado: esses itens pertencem ao CN6. Também não implementa attribution/usage/engagement (CN7), revenue share/settlement (CN8), console/analytics/certificação integral (CN9) ou IA.

## 2. Mapping canônico

`CreatorExerciseContentMapping` registra um vínculo governado entre:

- `exerciseId` — Exercise global já existente;
- `contentId` — CreatorContent CN3;
- `mediaAssetId` — Media Asset CN3 escolhido para a entrega daquele mapping;
- `scope` — `GLOBAL | TENANT`;
- `gymId` — `null` no GLOBAL e tenant autenticado no TENANT;
- `placement` — `PRIMARY | ALTERNATIVE`;
- `priority` — inteiro de 1 a 1000 para ordenação determinística;
- `status` — `DRAFT | PUBLISHED | UNPUBLISHED`;
- timestamps e motivo auditável de unpublish.

O asset escolhido deve pertencer ao `CreatorContent`. A escolha explícita do asset evita inferência ambígua quando um conteúdo possui múltiplos arquivos/renditions, sem transferir para CN5 a responsabilidade de versionamento/lifecycle do CN6.

## 3. Escopo e governança

- `GLOBAL`: somente `SUPER_ADMIN`, conteúdo GLOBAL, `gymId = null`;
- `TENANT`: somente `OWNER`/`MANAGER` com `activeGymId` autenticado, conteúdo TENANT do mesmo tenant;
- nenhum DTO aceita `gymId`;
- `SUPER_ADMIN` não usa rota TENANT como impersonation;
- Exercise permanece global e não ganha ownership tenant.

O banco possui FK física para `Exercise`, `CreatorContent` e `CreatorMediaAsset`, checks de escopo/estado e índices parciais. Pode haver múltiplos mappings ALTERNATIVE publicados, porém existe no máximo um `PRIMARY + PUBLISHED` por exercício em cada escopo efetivo (um global e um por tenant).

## 4. Workflow mínimo de publicação

Criar mapping produz `DRAFT`. Publicar exige, no momento da transição:

1. Exercise existente;
2. conteúdo e mapping no mesmo escopo governado;
3. Media Asset pertencente ao conteúdo;
4. Rights Grant CN2 ainda `EFFECTIVE`, rights holder ACTIVE, janela válida e consentimento vigente quando obrigatório;
5. Media Asset com `CreatorMediaStorageObject` CN4 verificado no provider atualmente configurado/homologado;
6. no TENANT, entitlement efetivo `content.tenant_private = true`;
7. no TENANT, `content.private_items_max` maior que zero e não excedido por itens privados publicados;
8. unicidade de PRIMARY PUBLISHED protegida em serviço e por índice parcial.

`UNPUBLISHED` exige motivo auditável. Re-publicação é permitida pelo workflow mínimo e gera novo fato de auditoria. O AuditLog preserva o histórico; CN5 não cria versionamento editorial paralelo.

## 5. Resolvedor de conteúdo do exercício

`GET /creator-network/exercises/:exerciseId/content-resolution` é tenant-scoped e aceita `OWNER`, `MANAGER`, `TRAINER` e `STUDENT`.

O resolvedor usa PE0-PE4 e nunca consulta nome comercial de plano. Para STUDENT, aplica também a preferência efetiva do usuário pelo resolvedor canônico.

Capabilities consultadas:

- `content.delivery_mode`;
- `content.iron_managed`;
- `content.tenant_private`;
- `content.external_youtube`.

A primeira policy efetiva reconhecida em `content.delivery_mode` define a estratégia:

- `IRON_ONLY`: tenta somente conteúdo GLOBAL gerenciado;
- `IRON_FIRST`: GLOBAL gerenciado → TENANT privado → YouTube legado permitido;
- `TENANT_PRIVATE_FIRST`: TENANT privado → GLOBAL gerenciado → YouTube legado permitido;
- `YOUTUBE_ONLY` / `YOUTUBE_EXTERNAL`: usa somente o Launch Bridge externo quando permitido.

Dentro de um grupo, PRIMARY vem antes de ALTERNATIVE, depois menor `priority`, publicação mais recente e ID como desempate final. Isso torna a resolução determinística.

## 6. Fail-closed em runtime

Um mapping PUBLISHED não torna o conteúdo eternamente elegível. Para cada candidato gerenciado, CN5 chama o delivery CN4, que revalida os direitos CN2 e exige storage no provider configurado antes de produzir URL efêmera.

Se um candidato não estiver mais elegível por expiração/revogação de direitos, storage ausente ou provider indisponível, o resolvedor tenta o próximo candidato permitido pela policy. O fallback externo só ocorre se `content.external_youtube = true` e `Exercise.videoUrl` for HTTPS em host YouTube reconhecido.

Ausência de policy efetiva, conteúdo elegível ou fallback autorizado retorna `NONE`; o sistema não inventa URL, asset, licença ou provider.

## 7. Launch Bridge preservado

`Exercise.videoUrl` permanece intocado no schema e no runtime legado. CN5 apenas o lê como fallback `EXTERNAL_REFERENCE` quando os entitlements e a policy permitirem. Um link público continua não significando propriedade, licença, rehosting ou direito comercial do IRON.

A retirada futura de `Exercise.videoUrl` continua exigindo bloco/migration/certificação próprios.

## 8. Concorrência e auditoria

Mutações usam `Serializable` com retry controlado `P2034/P2002` e AuditLog na mesma transação.

Eventos:

- `EXERCISE_CONTENT_MAPPING_REGISTERED`;
- `EXERCISE_CONTENT_MAPPING_PUBLISHED`;
- `EXERCISE_CONTENT_MAPPING_UNPUBLISHED`.

CN5 não registra view/click/play/engagement. Esses eventos pertencem ao CN7.

## 9. Migration

Migration aditiva: `20260905163500_exercise_content_mapping_publishing`.

Ela cria somente enums, tabela/constraints/índices/FKs do mapping. Não altera nem remove colunas de `Exercise`, não toca `Exercise.videoUrl`, financeiro, ProductPlan, Equipment, Aggregator ou Rights Vault.

## 10. Critério de saída

CN5 somente pode ser promovido quando:

- mapping GLOBAL/TENANT estiver isolado e auditável;
- FK para Exercise/Content/Media Asset estiver presente;
- PRIMARY PUBLISHED único por escopo/exercício estiver protegido fisicamente;
- publicação revalidar rights CN2 e storage CN4;
- tenant publishing respeitar `content.tenant_private` e `content.private_items_max`;
- resolvedor consumir `content.delivery_mode`, `content.iron_managed`, `content.tenant_private` e `content.external_youtube`;
- STUDENT consumir preferência efetiva PE3;
- `Exercise.videoUrl` permanecer fallback compatível e não for alterado;
- CN6-CN9 permanecerem fora do diff;
- npm audit high, Prisma generate, lint/typecheck, build e regressão completa estiverem verdes, sem testes críticos skipped.
