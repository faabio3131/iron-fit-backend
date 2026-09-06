# IRON-CN7 — Attribution + Usage Metering + Engagement Events

Data: 05/09/2026  
Baseline: `main @ 1c5f6096f3031b2913838e8812cf6860f54459b2`

## 1. Objetivo e fronteira

CN7 adiciona proveniência de atribuição, medição idempotente da resolução de conteúdo e um ledger imutável de engagement sobre o runtime canônico CN5/CN6.

CN7 não decide qual conteúdo é elegível: essa autoridade continua em CN5, com lifecycle/moderação CN6, rights CN2 e delivery CN4. CN7 também não calcula preço, comissão, revenue share, payable, settlement ou receita; isso pertence ao CN8. Agregações gerenciais, dashboards e analytics pertencem ao CN9.

## 2. Princípio de observabilidade

O IRON registra somente fatos cuja origem é explícita.

- `DELIVERY_RESOLVED` é `SERVER_OBSERVED`: significa que o servidor resolveu e devolveu uma entrega elegível. Não significa que o usuário reproduziu, assistiu ou concluiu o conteúdo.
- `CONTENT_OPENED`, `CONTENT_PROGRESS`, `CONTENT_COMPLETED` e `CONTENT_DISMISSED` são `CLIENT_REPORTED`.
- Nenhum evento reportado pelo cliente é promovido silenciosamente a evidência verificada pelo servidor.

Para `EXTERNAL_REFERENCE` via `Exercise.videoUrl`, o IRON não controla o player externo. Portanto progresso e conclusão são proibidos. O cliente pode apenas reportar abertura ou descarte sem percentual.

## 3. Attribution Snapshot

`CreatorContentAttributionSnapshot` preserva o estado exato usado na entrega gerenciada:

- `contentId`;
- `contentVersionId` APPROVED;
- `rightsGrantVersionId` ACTIVE;
- `rightsHolderId`;
- `creatorId` opcional;
- `creatorDisplayName` como crédito editorial congelado;
- obrigação e texto de attribution oriundos do Rights Vault;
- fingerprint SHA-256 determinístico.

Creator credit e rights ownership continuam conceitos distintos. A resposta da API explicita `creatorCreditIsRightsOwnership: false`.

Quando rights exigem attribution, o snapshot só é criado se houver `attributionText` não vazio. Quando não exigem, o texto persistido é `null`.

Snapshots são append-only: update/delete são bloqueados fisicamente no PostgreSQL.

## 4. Usage Session

Cada resolução bem-sucedida exige o header `x-iron-usage-key` com UUID. A unicidade física é:

`gymId + actorUserId + resolutionKey`.

Retry da mesma resolução reaproveita a mesma sessão e o mesmo evento `DELIVERY_RESOLVED`. Reutilizar a chave para outro conteúdo, asset, mapping, policy, attribution snapshot ou tipo de entrega falha com conflito.

A sessão congela:

- tenant e usuário autenticados;
- papel de audiência;
- exercício;
- delivery kind;
- mapping/content/version/asset/snapshot para conteúdo gerenciado;
- policy mode;
- fonte externa quando aplicável;
- target fingerprint.

URLs efêmeras de upload/delivery e URL externa não são persistidas em texto. No caso externo, a URL participa apenas do hash do alvo para detectar replay divergente.

## 5. Managed Content

Antes de medir uma resolução gerenciada, CN7 revalida dentro da transação:

1. mapping ainda `PUBLISHED` e ligado ao mesmo exercício/content/asset;
2. isolamento GLOBAL/TENANT;
3. `CreatorContent` ainda `ACTIVE`;
4. versão CN6 `APPROVED` exatamente para o asset resolvido;
5. Rights Grant CN2 `ACTIVE`;
6. Rights Holder `ACTIVE`;
7. janela temporal vigente;
8. consentimento vigente quando obrigatório.

CN4 continua sendo a autoridade final de delivery porque a resolução original CN5 delega a URL gerenciada ao CN4.

## 6. Engagement ledger

`CreatorContentUsageEvent` é append-only e possui os tipos:

- `DELIVERY_RESOLVED`;
- `CONTENT_OPENED`;
- `CONTENT_PROGRESS`;
- `CONTENT_COMPLETED`;
- `CONTENT_DISMISSED`.

Regras:

- `CONTENT_OPENED` não aceita percentual;
- `CONTENT_PROGRESS` exige 1..99 e crescimento monotônico;
- `CONTENT_COMPLETED` exige exatamente 100;
- `CONTENT_DISMISSED` aceita null ou 0..99, sem regressão abaixo do maior progresso anterior;
- progress/completion exigem `CONTENT_OPENED` anterior;
- completed/dismissed são terminais;
- existe no máximo um opened e um terminal por sessão;
- cada evento possui `eventKey` UUID único dentro da sessão;
- replay exato é idempotente; replay divergente falha.

As mesmas formas básicas são reforçadas por CHECKs e índices parciais no PostgreSQL.

## 7. Tenant isolation e autoridade

A resolução e o engagement são permitidos apenas a `OWNER`, `MANAGER`, `TRAINER` e `STUDENT` dentro de `activeGymId` autenticado. `SUPER_ADMIN` global não usa a rota como impersonation de tenant.

O DTO de engagement não aceita `gymId`, `userId`, `exerciseId` ou `sessionId` como autoridade de corpo. Tenant, usuário, exercício e sessão são derivados do contexto/rota autenticados e conferidos em conjunto.

## 8. Concorrência e imutabilidade

Criação de attribution snapshot, usage session e event usa `Serializable` com retry para `P2034` e `P2002`.

O banco protege:

- fingerprints SHA-256;
- UUID da resolution key;
- shape MANAGED_CONTENT versus EXTERNAL_REFERENCE;
- role/policy válidos;
- unicidade da resolução por tenant/usuário/chave;
- unicidade do eventKey por sessão;
- um DELIVERY_RESOLVED, um CONTENT_OPENED e um terminal por sessão;
- semântica de percentuais e observation source;
- foreign keys do domínio Creator Network;
- bloqueio físico de UPDATE/DELETE em snapshot, sessão e evento.

## 9. Compatibilidade

`Exercise.videoUrl` continua existindo como Launch Bridge HTTPS YouTube governado pelos entitlements. CN7 não converte referência pública em propriedade ou licença.

CN7 não altera Product Entitlements, Subscription financeira, Charge, Equipment, Aggregator Hub, gateway, pricing ou IA.

## 10. Fronteiras seguintes

- CN8: Commercial Rules + Revenue Share + Settlement.
- CN9: Operational Console + Analytics + Full Creator Network Certification.

Nenhuma dessas responsabilidades é antecipada em CN7.
