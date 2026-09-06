# IRON-CN6 — Moderation, Quality, Versioning & Content Lifecycle

Data: 05/09/2026  
Baseline: `main @ 609b9064a2e27c9cf3c06976e1a23f64be46f977`

## 1. Objetivo e fronteira

CN6 governa a evolução editorial do `CreatorContent` criado no CN3, a moderação humana/operacional, a qualidade estruturada de cada versão e o lifecycle do conteúdo que pode ser publicado pelo CN5.

CN6 não cria conteúdo externo, não substitui o Rights Vault CN2, não substitui a ingestão/delivery CN4 e não recria o mapping/publishing CN5. Também não implementa attribution, usage ou engagement do CN7, commercial rules/revenue share/settlement do CN8, console/analytics/certificação integral do CN9 ou IA.

## 2. Lifecycle canônico

`CreatorContent.lifecycleStatus` passa a ser:

- `DRAFT`: conteúdo canônico ainda não liberado para publicação;
- `ACTIVE`: conteúdo possui versão editorial `APPROVED` e pode ser usado pelo publishing CN5;
- `SUSPENDED`: conteúdo temporariamente inelegível; exige motivo e reativação explícita;
- `RETIRED`: estado terminal e permanente.

Transições permitidas pelo serviço:

- `DRAFT -> ACTIVE` por `activate`;
- `ACTIVE -> SUSPENDED` por `suspend` com motivo auditável;
- `SUSPENDED -> ACTIVE` somente por `reactivate` explícito;
- qualquer estado não terminal -> `RETIRED` por `retire` com motivo auditável.

Uma nova versão aprovada nunca reativa automaticamente um conteúdo `SUSPENDED`. `RETIRED` não aceita nova versão nem novo review.

## 3. Versionamento editorial

`CreatorContentVersion` é um snapshot editorial imutável composto por:

- `contentId`;
- número monotônico `version`;
- `mediaAssetId` exato que a versão certifica;
- `editorialTitle`;
- `editorialDescription` opcional;
- `status = DRAFT | APPROVED | REJECTED | SUPERSEDED`;
- fingerprint determinístico;
- timestamps.

Existe no máximo uma versão `DRAFT` e uma versão `APPROVED` por conteúdo. Aprovar uma nova versão transforma a anterior `APPROVED` em `SUPERSEDED`, preservando o histórico. Rejeição não altera a versão aprovada anterior.

Não existe endpoint de edição de versão. Para mudar mídia ou metadados editoriais cria-se uma nova versão.

## 4. Moderação e qualidade

`CreatorContentReview` é um fato imutável, um por versão revisada. O review registra:

- decisão `APPROVE | REJECT`;
- `technicalQuality`;
- `instructionalQuality`;
- `safetyQuality`;
- `accessibilityQuality`;
- notas opcionais;
- `reviewerUserId` e timestamps.

Qualidade não usa nota numérica arbitrária. O vocabulário é `PASS | FAIL | NOT_APPLICABLE`.

Para `APPROVE`:

- technical = `PASS`;
- instructional = `PASS`;
- safety = `PASS`;
- accessibility = `PASS` ou `NOT_APPLICABLE`.

Para `REJECT` deve existir pelo menos um `FAIL`. `NOT_APPLICABLE` é aceito apenas em accessibility pela API. As mesmas regras são reforçadas por `CHECK` no PostgreSQL.

## 5. Evidência técnica antes de aprovação

Uma versão só pode receber decisão `APPROVE` se o `mediaAssetId` possuir `CreatorMediaStorageObject` verificado no provider configurado/homologado pelo CN4.

A aprovação editorial não transforma rights expirados em válidos. Rights continuam autoridade do CN2 e são revalidados novamente na ativação/reativação e no delivery CN4.

## 6. Ativação e reativação fail-closed

`activate` e `reactivate` exigem simultaneamente:

1. uma versão `APPROVED` vigente no domínio CN6;
2. Rights Grant CN2 `EFFECTIVE`, holder ACTIVE, janela válida e consentimento vigente quando requerido;
3. storage CN4 verificado para o `mediaAssetId` da versão aprovada no provider configurado.

A ativação não publica mapping automaticamente. O CN5 continua sendo a autoridade de mapping/publishing.

## 7. Integração física com CN5

CN6 adiciona uma proteção física no PostgreSQL para `CreatorExerciseContentMapping`.

Qualquer tentativa de criar/atualizar mapping para `PUBLISHED` só é aceita quando:

- o `CreatorContent` está `ACTIVE`;
- existe uma versão `APPROVED` para esse conteúdo;
- a versão aprovada certifica exatamente o mesmo `mediaAssetId` do mapping.

Assim, o CN5 não consegue publicar conteúdo sem certificação CN6 mesmo se um chamador contornar a camada de serviço.

Quando uma nova versão é aprovada em conteúdo já `ACTIVE`, mappings publicados que apontem para outro `mediaAssetId` são despublicados com `CN6_VERSION_SUPERSEDED`. Mappings para o mesmo asset permanecem válidos.

Ao suspender ou retirar conteúdo, todos os mappings `PUBLISHED` daquele conteúdo são despublicados de forma atômica. `reactivate` não republica nenhum mapping automaticamente.

## 8. Cutover dos mappings anteriores ao CN6

Mappings que já estavam `PUBLISHED` antes da existência do CN6 não possuem versão editorial certificada. A migration faz um cutover fail-closed:

- preserva a linha e o `publishedAt` histórico;
- muda apenas `status` para `UNPUBLISHED`;
- grava `unpublishedAt`;
- grava `CN6_CERTIFICATION_REQUIRED` como motivo.

Nada é apagado. Depois da criação/review/ativação da versão correta, o operador pode publicar novamente pelo workflow CN5. Enquanto isso, o Launch Bridge legado continua disponível conforme entitlements/policy.

## 9. Escopo e governança

- `GLOBAL`: somente `SUPER_ADMIN`, `gymId = null`;
- `TENANT`: somente `OWNER`/`MANAGER` com `activeGymId` autenticado;
- nenhum DTO CN6 aceita `gymId`;
- `SUPER_ADMIN` não usa rota TENANT para impersonation;
- lifecycle e versões sempre permanecem no mesmo `CreatorContent` e scope já governados pelo CN3.

## 10. Concorrência e auditoria

Todas as mutações CN6 usam `Serializable` com retry controlado para `P2034/P2002` e AuditLog na mesma transação.

Eventos:

- `CONTENT_VERSION_CREATED`;
- `CONTENT_VERSION_REVIEWED`;
- `CONTENT_LIFECYCLE_ACTIVATED`;
- `CONTENT_LIFECYCLE_SUSPENDED`;
- `CONTENT_LIFECYCLE_REACTIVATED`;
- `CONTENT_LIFECYCLE_RETIRED`.

Nenhum evento CN6 representa view, play, click, usage ou engagement. Esses fatos pertencem ao CN7.

## 11. Migration

Migration: `20260905205000_content_moderation_quality_versioning_lifecycle`.

Ela:

- adiciona enums/colunas de lifecycle ao `CreatorContent`;
- cria `CreatorContentVersion` e `CreatorContentReview`;
- cria constraints, índices, FKs e unicidades parciais;
- executa o cutover reversível de mappings pré-CN6;
- instala o trigger de certificação CN6 para publicação CN5.

Não remove coluna, tabela ou histórico. Não altera student finance, ProductPlan, pricing, gateway, Equipment, Aggregator, Creator Rights Vault, Creator Registry ou IA.

## 12. Launch Bridge

`Exercise.videoUrl` permanece intacto. CN6 não interpreta um URL público como propriedade/licença, não faz rehosting e não remove o fallback externo.

A eventual remoção de `Exercise.videoUrl` continua exigindo bloco, migration e certificação próprios.

## 13. Fronteiras seguintes

- CN7: Attribution + Usage Metering + Engagement Events;
- CN8: Commercial Rules + Revenue Share + Settlement;
- CN9: Operational Console + Analytics + Full Creator Network Certification.

CN6 não antecipa nenhuma dessas responsabilidades.

## 14. Critério de saída

CN6 só pode ser promovido após:

1. schema/migration consistentes;
2. Prisma generate verde;
3. lint/typecheck verde;
4. build verde;
5. regressão permanente completa verde;
6. branch gate verde;
7. PR gate verde;
8. squash merge;
9. pós-merge da `main` verde;
10. registro na Ordem Mestre antes de liberar CN7.
