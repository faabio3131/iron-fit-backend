# IRON-CN2 — Rights Vault + Licensing & Consent Domain

Data: 05/09/2026  
Baseline: `main @ b7a82bcecc10eccd3c5e23102d71e39a3ea51706`

## 1. Objetivo e fronteira

CN2 materializa o Rights Vault definido no CN0. O bloco registra titularidade declarada/governada, bases de licença/cessão/consentimento, escopos permitidos, território, validade, atribuição, evidência e revogação de forma versionada e auditável.

CN2 não cria Content Catalog, `contentId`, Media Asset, upload, storage, CDN, Exercise ↔ Content mapping, publishing, moderação, usage metering, revenue share, settlement, pricing, gateway ou IA. Essas responsabilidades permanecem nos blocos CN3-CN9.

A regra estrutural permanece: **Creator identity não equivale a rights holder e rights holder não equivale automaticamente a autorização efetiva**.

## 2. Escopos do Vault

O Vault possui dois contextos canônicos:

- `GLOBAL`: governado exclusivamente por `SUPER_ADMIN`, sem `gymId`;
- `TENANT`: governado por `OWNER`/`MANAGER` somente no tenant derivado da identidade autenticada.

O cliente não fornece `gymId` para selecionar autoridade. Um `SUPER_ADMIN` em contexto global não usa a rota tenant como mecanismo de impersonation. Rights holder, grant e versões pertencem ao mesmo contexto; leitura e mutação cross-tenant falham fechadas.

## 3. Rights Holder independente de Creator

`CreatorRightsHolder` representa a parte que concede ou detém o direito relevante. Tipos:

- `CREATOR` — ligado explicitamente a um `Creator` do CN1;
- `PERSON` — pessoa titular sem inferência de identidade de creator;
- `ORGANIZATION` — pessoa jurídica/organização;
- `TENANT` — academia no contexto tenant.

Um rights holder `CREATOR` exige `creatorId`, mas essa ligação não converte identidade em prova de titularidade; ela apenas registra quem é a parte declarada no instrumento/evidência. Outros tipos não aceitam `creatorId`.

Rights holders são idempotentes por fingerprint canônico. `RETIRED` preserva histórico e não pode ocorrer enquanto existirem grants `ACTIVE` vinculados.

## 4. Rights Grant lógico e versões imutáveis

`CreatorRightsGrant` é a identidade lógica da autorização. Seus termos vivem em `CreatorRightsGrantVersion`, permitindo evolução sem reescrever fatos históricos.

Relações gerenciadas permitidas no CN2:

- `LICENSED_CONTENT`;
- `IRON_OWNED`;
- `TENANT_OWNED`.

`EXTERNAL_REFERENCE` não entra no Rights Vault como managed grant e continua semanticamente separado. O Vault não promove link público para licença.

Regras físicas de escopo:

- grant `TENANT` usa `TENANT_OWNED`;
- `TENANT_OWNED` nunca é grant `GLOBAL`;
- grant global não carrega `gymId`;
- grant tenant exige `gymId` derivado do contexto autenticado.

## 5. Dimensões obrigatórias de direitos

Cada versão registra:

- `RIGHTS_HOLDER`: `rightsHolderId`;
- `LICENSE_BASIS`: `LICENSE | ASSIGNMENT | CONSENT | OWNERSHIP_ATTESTATION | OTHER`;
- `USAGE_SCOPE`: lista canônica não vazia;
- `DELIVERY_SCOPE`: lista canônica não vazia;
- `TERRITORY`: lista canônica não vazia;
- `VALIDITY_WINDOW`: `validFrom` + `validUntil` opcional;
- `REVOCATION_STATUS`: lifecycle da versão, timestamps e motivo;
- `ATTRIBUTION_REQUIREMENT`: flag + texto obrigatório quando aplicável;
- evidência por `evidenceReference` + SHA-256 obrigatório;
- `termsSha256` opcional para vincular termos/documento adicional;
- `requiresCreatorConsent` quando a autorização exige consentimento separado.

O `evidenceReference` é uma referência de proveniência, não conteúdo jurídico interpretado pela IA. O SHA-256 liga o registro à evidência exata sem colocar documento sensível no AuditLog.

## 6. Lifecycle de Grant Version

Estados:

`DRAFT | ACTIVE | SUPERSEDED | SUSPENDED | REVOKED`.

Invariantes:

1. toda nova versão nasce `DRAFT`;
2. somente a versão mais recente pode ser ativada;
3. banco garante no máximo uma versão `ACTIVE` por grant;
4. ativação exige rights holder `ACTIVE`, janela temporal vigente e consentimento válido quando obrigatório;
5. ao ativar nova versão, a `ACTIVE` anterior vira `SUPERSEDED` atomicamente;
6. `SUPERSEDED` permanece histórico e imutável;
7. `ACTIVE` pode ser `SUSPENDED` com motivo auditável;
8. `SUSPENDED` só retorna a `ACTIVE` se continuar sendo a versão mais recente e todos os requisitos continuarem válidos;
9. `DRAFT`, `ACTIVE` ou `SUSPENDED` podem ser `REVOKED` com motivo auditável;
10. expiração ou incompatibilidade não são convertidas silenciosamente em autorização.

Todas as mutações críticas usam `Serializable`, retry controlado para conflitos conhecidos e `AuditLog` na mesma transação.

## 7. Consentimentos versionados

`CreatorRightsConsent` registra consentimento separado por creator e finalidade jurídica/operacional:

`CONTENT_USE | LIKENESS | VOICE | PERFORMANCE | OTHER`.

Cada consentimento possui:

- creator do CN1;
- versão positiva;
- `purposeScopes` não vazios;
- janela de validade;
- referência de evidência + SHA-256;
- lifecycle `ACTIVE | SUPERSEDED | REVOKED`.

Novo consentimento semanticamente diferente supersede atomicamente o anterior do mesmo `(grantVersion, creator, kind)`. Novo consentimento exige Creator `ACTIVE`, garantindo identidade governada no CN1 sem afirmar que a identidade, isoladamente, prova os direitos.

Se um grant `ACTIVE` exige creator consent e a revogação remove o último consentimento `ACTIVE` e vigente, a versão é **automaticamente SUSPENDED na mesma transação**. Isso preserva o fail-closed definido no CN0.

## 8. Avaliação efetiva de direitos

A rota de avaliação não devolve apenas um booleano. Ela retorna:

- `effective`;
- `reason` determinístico;
- relation kind;
- versão;
- rights holder;
- basis;
- usage scopes;
- delivery scopes;
- territories;
- validity window;
- attribution;
- hashes de evidência/termos;
- requisito de consentimento.

Razões fail-closed incluem, entre outras:

- `NO_VERSION`;
- `LATEST_VERSION_DRAFT`;
- `LATEST_VERSION_SUSPENDED`;
- `LATEST_VERSION_REVOKED`;
- `RIGHTS_HOLDER_INACTIVE`;
- `NOT_YET_VALID`;
- `EXPIRED`;
- `REQUIRED_CREATOR_CONSENT_MISSING`.

CN3+ deverá consumir essa decisão estruturada quando conteúdo canônico existir. CN2 ainda não liga grant a conteúdo.

## 9. Segurança e privacidade

- nenhum endpoint aceita `gymId` como autoridade;
- global e tenant são contextos mutuamente governados;
- tenant A não lê nem altera holder/grant/consent de tenant B;
- evidência jurídica é referenciada e hashada; AuditLog registra hashes e metadados mínimos, não o documento sensível;
- revogação e supersession preservam fatos históricos;
- `EXTERNAL_REFERENCE` permanece fora de managed rights;
- IA não cria, completa, presume ou interpreta autorização como fato operacional.

## 10. Migration e constraints físicas

Migration CN2: `20260905150500_rights_vault_licensing_consent`.

A migration é aditiva e cria somente o domínio do Rights Vault. Constraints protegem:

- coerência `GLOBAL/TENANT` x `gymId`;
- coerência de rights holder `CREATOR` x `creatorId`;
- coerência `TENANT_OWNED` x escopo;
- versão positiva;
- listas mínimas de usage/delivery/territory/purpose;
- `validUntil > validFrom`;
- hashes SHA-256 com 64 hex;
- texto de atribuição quando obrigatório;
- uma versão `ACTIVE` por grant;
- um consentimento `ACTIVE` por `(grantVersionId, creatorId, kind)`;
- FKs `RESTRICT` para preservar cadeia histórica.

Nenhuma tabela do financeiro do aluno, ProductPlan, Equipment, Aggregator, Exercise ou Content Catalog é alterada.

## 11. Auditabilidade

Eventos mínimos do CN2:

- `RIGHTS_HOLDER_REGISTERED`;
- `RIGHTS_HOLDER_RETIRED`;
- `RIGHTS_GRANT_CREATED`;
- `RIGHTS_GRANT_VERSION_CREATED`;
- `RIGHTS_GRANT_VERSION_ACTIVATED`;
- `RIGHTS_GRANT_VERSION_SUPERSEDED`;
- `RIGHTS_GRANT_VERSION_SUSPENDED`;
- `RIGHTS_GRANT_VERSION_RESUMED`;
- `RIGHTS_GRANT_VERSION_REVOKED`;
- `RIGHTS_CONSENT_RECORDED`;
- `RIGHTS_CONSENT_SUPERSEDED`;
- `RIGHTS_CONSENT_REVOKED`;
- `RIGHTS_GRANT_AUTO_SUSPENDED_NO_REQUIRED_CONSENT`.

Eventos tenant carregam `gymId` do contexto autenticado; eventos globais usam `gymId = null`.

## 12. Critério de saída

CN2 somente pode ser promovido quando:

- Prisma generate reconhecer integralmente o domínio Rights Vault;
- schema e migration estiverem alinhados;
- global/tenant isolation e RBAC estiverem comprovados;
- versionamento, idempotência, uma ACTIVE por grant, supersession, suspension, resume e revocation estiverem protegidos;
- consentimento obrigatório falhar fechado e revogação suspender grant quando necessário;
- avaliação efetiva retornar razões/dimensões auditáveis;
- CN3+ permanecer fora do diff;
- npm audit high, lint/typecheck, build e regressão completa estiverem verdes, sem testes críticos skipped.
