# IRON-CN9 — Creator Operations Console + Analytics + Full Certification

Baseline canônica: `main @ b1a4a40ada4f46834fe3ed7264ad2c3b8c498f8a`  
Bloco: `IRON-CN9`  
Status desta especificação: CONTRATO CANÔNICO CONGELADO

## 1. Objetivo e fronteira

CN9 fecha a Fitness Creator Network com duas superfícies estritamente projetivas: console operacional e analytics. O bloco consolida fatos já materializados por CN1-CN8; não cria um segundo source of truth, não antecipa novos domínios e não transforma analytics em autoridade de negócio.

CN9 é read-only. Nenhuma rota CN9 cria, altera, aprova, suspende, revoga, publica, acumula, liquida ou exclui estado de Creator Network, financeiro, direitos, mídia ou conteúdo.

## 2. Fontes canônicas CN1-CN8

CN9 lê exclusivamente os fatos canônicos existentes:

- CN1 — `Creator` e `CreatorIdentity`: estado do creator e identidade governada;
- CN2 — `CreatorRightsGrant`, `CreatorRightsGrantVersion`, `CreatorRightsConsent` e `CreatorRightsHolder`: direitos, validade e consentimento;
- CN3 — `CreatorContent` e `CreatorMediaAsset`: catálogo e ativos lógicos;
- CN4 — `CreatorMediaIngestion` e `CreatorMediaStorageObject`: preparação, verificação e falhas técnicas;
- CN5 — `CreatorExerciseContentMapping`: publicação Exercise ↔ Content;
- CN6 — `CreatorContentVersion` e `CreatorContentReview`: lifecycle, versionamento, moderação e qualidade;
- CN7 — `CreatorContentUsageSession`, `CreatorContentUsageEvent` e `CreatorContentAttributionSnapshot`: uso, engagement e atribuição observável;
- CN8 — `CreatorCommercialAgreement`, `CreatorCommercialRuleVersion`, `CreatorCommercialAccrual`, `CreatorSettlementBatch` e `CreatorSettlementItem`: fatos comerciais e settlement.

Não existe migration CN9 e não existe tabela de dashboard/analytics. Projeções são calculadas por queries agregadas sobre esses modelos.

## 3. Autoridade, RBAC e tenant isolation

Rotas CN9 usam `JwtAuthGuard` + `RolesGuard`.

- `GLOBAL`: somente `SUPER_ADMIN`, sem tenant selecionado pelo cliente;
- `TENANT`: somente `OWNER`/`MANAGER` com `activeGymId` derivado da identidade autenticada;
- `SUPER_ADMIN` não usa a rota TENANT como mecanismo de impersonation;
- nenhum DTO, body, param ou query CN9 aceita `gymId`, `activeGymId` ou `userId` como autoridade;
- toda projeção tenant aplica filtro físico pelo tenant autenticado antes de agregar.

Rotas canônicas:

- `GET /creator-network/operations/:scope/overview`
- `GET /creator-network/operations/:scope/analytics?days=N`

`scope` aceita apenas `global` ou `tenant`. `days` é apenas janela temporal, limitada a 1..365 dias, e nunca seleciona tenant.

## 4. Console operacional read-only

O overview expõe somente agregados operacionais necessários à gestão:

- creators por status;
- versões de rights grants por status;
- rights grants ACTIVE atualmente efetivos;
- rights grants ACTIVE expirando na janela operacional de atenção de 30 dias;
- records ACTIVE já expirados que exigem atenção operacional;
- conteúdo por lifecycle;
- versões editoriais por status;
- reviews por decisão;
- ingestões de mídia por status e falhas por código;
- mappings de publicação por status.

A janela de 30 dias é apenas sinal operacional. Ela não altera a avaliação canônica de direitos de CN2 e não autoriza nem bloqueia conteúdo.

## 5. Analytics CN7

Analytics de uso lê CN7 por janela temporal e retorna somente fatos agregados:

- sessões por `deliveryKind`;
- eventos por `eventType` e `observationSource`;
- total de sessões e eventos.

CN9 não expõe `actorUserId`, resolution keys, fingerprints, referências externas individuais ou histórico por usuário. Nenhuma métrica de conclusão é inferida quando CN7 não observou o evento correspondente.

## 6. Analytics comercial CN8

CN9 consolida separadamente:

- accruals atribuídos ao consumo, por moeda;
- settlement batches pertencentes ao escopo autorizado, por moeda e status.

Valores monetários permanecem em **minor units inteiros**. A implementação converte somas para `BigInt` antes de serializar como string decimal, evitando arredondamento binário de ponto flutuante. Moedas nunca são somadas entre si; cada `currency` mantém bucket independente.

Uma visão TENANT pode observar accruals cujo `consumptionGymId` seja seu tenant, inclusive quando a regra comercial é GLOBAL. Settlement batches TENANT só aparecem quando `scope = TENANT` e `gymId` corresponde ao tenant autenticado. A visão GLOBAL, exclusiva do SUPER_ADMIN, pode agregar a plataforma inteira, sempre preservando buckets por moeda.

## 7. Proteção de PII e dados sensíveis

CN9 não projeta:

- `actorUserId`;
- `reviewerUserId`;
- e-mail, telefone ou credenciais;
- `beneficiaryLegalName`/`legalName` em analytics;
- evidence references/hashes em painéis agregados;
- tokens, provider secrets, raw payloads ou external member identifiers.

Creator `displayName` também não é necessário para os endpoints agregados deste bloco; CN9 trabalha com contagens e estados.

## 8. Imutabilidade e proibições

Services CN9 podem usar somente operações de leitura/agregação (`count`, `groupBy`, `findMany` quando indispensável). São proibidos em CN9:

- `create`, `update`, `upsert`, `delete` e variantes;
- `$transaction` de mutação;
- `AuditService` para criar novo fato a partir de uma simples leitura;
- mutação de CN2/CN4/CN5/CN6/CN7/CN8;
- chamadas a gateway, PIX, banco, storage provider ou aggregator provider;
- LLM, OpenAI, machine learning, forecast ou recomendação automática.

## 9. Certificação integral CN0-CN9

CN9 só pode ser certificado quando:

1. documentação e runtime CN9 estiverem conectados ao `CreatorNetworkModule`;
2. não houver migration/schema CN9;
3. isolamento GLOBAL/TENANT e IDOR estiverem cobertos por regressão permanente;
4. serviços forem comprovadamente read-only;
5. PII proibida não for projetada;
6. dinheiro permanecer em minor units, separado por moeda e sem aritmética float;
7. todos os testes permanentes CN0-CN9 existirem e a suíte integral permanecer sem skips;
8. `npm audit --audit-level=high`, Prisma generate, lint/typecheck, build e `node --test test/*.test.mjs` estiverem 100% verdes.

## 10. Fora de escopo

CN9 não altera mobile, painel externo, autenticação, Product Entitlements, Equipment, Aggregator, Student Finance, `Exercise.videoUrl`, media provider homologation ou integrações Wellhub/TotalPass. Depois da certificação CN9, a execução deve parar conforme a ordem vigente.