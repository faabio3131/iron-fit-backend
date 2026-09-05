# IRON-CN1 — Creator Registry + Identity & Governance

Data: 05/09/2026  
Baseline: `main @ 7399a549b6194e975dd4227a07381850bc16b368`

## 1. Objetivo e fronteira

CN1 materializa o registro canônico global de creators do IRON e a governança de identidades verificáveis. O bloco não cria direitos autorais, licenças, consentimentos, catálogo de conteúdo, media assets, ingestão, CDN, publishing, moderação, usage metering ou settlement.

A regra constitucional desta fase é: **identidade de creator não equivale a titularidade de direitos**. Um creator pode ser autor, apresentador, treinador, uploader ou identidade pública relacionada ao material futuro, mas qualquer autorização de uso dependerá do Rights Vault do CN2.

## 2. Domínio canônico

### Creator

`Creator` é global e governado pelo IRON, sem `gymId`.

Campos canônicos:

- `slug` global único e estável;
- `displayName`;
- `bio` opcional;
- lifecycle `PENDING | ACTIVE | SUSPENDED | RETIRED`;
- timestamps de criação e atualização.

Não há delete operacional em CN1. `RETIRED` é terminal para preservar referência histórica e auditabilidade.

### CreatorIdentity

Uma identidade liga um Creator a uma identidade externa verificável por:

- `providerCode` canônico em maiúsculas;
- `externalSubject` estável do provider;
- `handle` opcional;
- `profileUrl` HTTPS opcional;
- lifecycle `UNVERIFIED | VERIFIED | REVOKED`;
- timestamps de verificação/revogação.

A combinação `(providerCode, externalSubject)` é globalmente única. Uma mesma identidade externa não pode ser silenciosamente reivindicada por dois creators.

CN1 não armazena senha, token, segredo do provider, documento de licença ou conteúdo de mídia.

## 3. Invariantes de lifecycle

1. todo Creator nasce `PENDING`;
2. `ACTIVE` exige pelo menos uma `CreatorIdentity` `VERIFIED`;
3. `SUSPENDED` exige motivo auditável e só é transição direta de `ACTIVE`;
4. `RETIRED` exige motivo auditável e é terminal;
5. identidade nasce `UNVERIFIED`;
6. `REVOKED` é terminal no CN1;
7. a revogação da última identidade `VERIFIED` de um Creator `ACTIVE` suspende o Creator atomicamente;
8. replay da criação do mesmo creator/identidade é idempotente quando semanticamente igual;
9. colisão de slug com definição diferente ou identidade já pertencente a outro creator falha fechada;
10. todas as mutações críticas usam transação `Serializable`, retry controlado e `AuditLog` na mesma unidade atômica.

## 4. Segurança e autoridade

- criação de Creator: `SUPER_ADMIN`;
- mudança de lifecycle: `SUPER_ADMIN`;
- inclusão, verificação e revogação de identidade: `SUPER_ADMIN`;
- leitura do registry: `SUPER_ADMIN`, `OWNER`, `MANAGER`, `TRAINER`;
- nenhuma mutação recebe ou confia em `gymId`;
- tenant não cria, ativa, verifica, suspende ou aposenta creator global;
- nenhum status de Creator ou CreatorIdentity concede direitos sobre conteúdo.

## 5. Persistência e Prisma multifile

CN1 introduz `prisma/creator-network.prisma` e configura o projeto para schema multifile apontando `prisma.schema` para `./prisma`. O `schema.prisma` principal, as migrations existentes e a nova migration permanecem no mesmo diretório canônico `prisma/`.

A mudança é organizacional e aditiva: modelos Creator Network podem evoluir em arquivo de domínio sem reformatar ou reescrever o schema legado inteiro.

Migration CN1: `20260905143500_creator_registry_identity_governance`.

## 6. Auditabilidade

Eventos mínimos:

- `CREATOR_REGISTERED`;
- `CREATOR_STATUS_CHANGED`;
- `CREATOR_IDENTITY_REGISTERED`;
- `CREATOR_IDENTITY_VERIFIED`;
- `CREATOR_IDENTITY_REVOKED`;
- `CREATOR_AUTO_SUSPENDED_NO_VERIFIED_IDENTITY`.

O audit é global (`gymId = null`) porque o registry é propriedade da plataforma, não de um tenant.

## 7. Separação obrigatória de CN2+

Fora do CN1:

- rights holder;
- licença, cessão, consentimento e bases jurídicas de uso;
- território, delivery scope e validity window de direitos;
- creator ↔ content ownership;
- Content Catalog / Media Asset;
- upload, storage, CDN ou provider de mídia;
- Exercise ↔ Content mapping;
- publishing e moderação;
- attribution/usage/engagement;
- revenue share e settlement.

Esses domínios permanecem bloqueados nos respectivos blocos CN2-CN9.

## 8. Critério de saída

CN1 só pode ser promovido quando:

- Prisma generate reconhecer `Creator` e `CreatorIdentity` via schema multifile;
- migration e modelos Prisma estiverem semanticamente alinhados;
- build e lint/typecheck estiverem verdes;
- regressão comprovar registry global, unicidade de identidade, RBAC, lifecycle, audit atômico e separação de rights;
- regressão completa continuar verde, sem testes críticos skipped e sem vulnerabilidades high.
