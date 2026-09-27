# IRON — Bloco 5 — Infraestrutura, Homologação e Operação

Status: CANDIDATE — infraestrutura interna em certificação. Este documento não declara produção real sem evidência física.

## Arquitetura única por ambiente

DEV, HOMOLOG e PROD executam a mesma aplicação NestJS, o mesmo Prisma schema e as mesmas migrations. As diferenças permitidas são somente configuração, secrets, endpoints, capacidade e integrações sandbox/produção.

Fluxo de release:

```
Git main -> CI -> imagem reproduzível -> prisma migrate deploy -> health/readiness -> exposição controlada
```

## Runtime

- Node.js 22.
- Build por Dockerfile versionado.
- Processo: `node dist/src/main.js`.
- Porta: `PORT`, default local 3333.
- Health: `/api/v1/health/live`.
- Readiness: `/api/v1/health/ready`, que executa consulta real no PostgreSQL.
- Métricas agregadas: `/api/v1/health/metrics`.
- Shutdown hooks habilitados.

## Configuração e secrets

Secrets nunca são commitados. Variáveis mínimas de ambiente para runtime comercial incluem:

- DATABASE_URL
- JWT_SECRET
- CORS_ORIGINS
- TRUST_PROXY_HOPS
- MFA_ENCRYPTION_KEY
- AUTH_ACTION_TOKEN_ENCRYPTION_KEY
- AUTH_REQUIRE_VERIFIED_EMAIL
- IRON_FIT_TRIAL_PLAN_CODE
- IRON_FIT_TRIAL_DAYS

Billing e providers externos permanecem fail-closed quando adapter/credencial homologada não está disponível.

## Deploy

`railway.toml` é a configuração candidata de homologação:

- Dockerfile como builder.
- `npx prisma migrate deploy` em pre-deploy.
- healthcheck físico de readiness.
- restart ON_FAILURE.
- branch `main` como fonte de release.

Não promover deploy com migrations pendentes, readiness vermelho ou CI vermelho.

## Rollback

Aplicação:
1. identificar deployment anterior conhecido como verde;
2. executar rollback da imagem/deployment;
3. validar liveness/readiness;
4. executar smoke crítico;
5. registrar incidente.

Banco:
- migrations Prisma são forward-only no ambiente compartilhado;
- rollback de schema destrutivo não é automático;
- correção deve preferir migration compensatória;
- restauração de backup é procedimento de recuperação, não mecanismo rotineiro de deploy.

## Backup e restore

Para banco gerenciado, confirmar na plataforma:
- política de backup disponível no plano;
- retenção;
- região;
- restore suportado.

Drill mínimo de restore deve ocorrer em ambiente seguro e registrar:
- timestamp do snapshot/backup;
- origem;
- destino;
- verificação de constraints/migrations;
- checks de integridade;
- resultado.

Nunca executar teste destrutivo de restore diretamente sobre produção.

## Observabilidade

Cada requisição recebe/propaga `X-Request-Id`. O log HTTP estruturado contém somente:
- requestId;
- método;
- path;
- status;
- duração.

Não inclui body, Authorization ou cookies.

Métricas de runtime:
- requestTotal;
- error5xxTotal;
- averageDurationMs;
- maxDurationMs;
- uptimeSeconds;
- RSS;
- heap usado.

Alertas mínimos recomendados na plataforma:
- readiness indisponível;
- deployment failed/crashed;
- taxa de 5xx;
- latência anormal;
- CPU/memória próximos do limite;
- PostgreSQL indisponível;
- backup/restore failure.

## CORS / TLS

Produção exige `CORS_ORIGINS` explícito. TLS deve terminar no provedor de edge/runtime com certificado válido. `TRUST_PROXY_HOPS` só deve ser configurado conforme topologia física comprovada.

## Banco

A fonte de schema é `prisma/schema.prisma` + `prisma/migrations`.

Gates:
- fresh install com todas as migrations;
- `prisma migrate deploy` em upgrade;
- constraints e índices do schema;
- readiness com SELECT 1;
- backup/restore drill físico.

## Repositório

A linha oficial é `main`. Preferência:
- mudanças via PR;
- CI requerido;
- sem force-push/deleção;
- squash merge;
- ruleset/branch protection quando suportado pela conta e pela integração administrativa.

A ausência de ruleset não pode ser escondida como “protegido”.

## Estado externo observado em 26/09/2026

### Supabase `gym-saas`

O projeto físico foi reativado e chegou a `ACTIVE_HEALTHY`, mas **não é homologação válida do CURRENT**:

- `_prisma_migrations` contém somente `20260831182410_init`;
- não existem `TenantProductSubscription`, `SaasBillingAgreement` nem `AuthActionToken`;
- `User.emailVerifiedAt` e `Session.absoluteExpiresAt` também não existem;
- portanto o banco está materialmente atrás do schema atual e não pode receber claim de homologação;
- a auditoria Supabase apontou tabelas `public` sem RLS/expostas pela Data API. Esse risco deve ser resolvido antes de qualquer uso externo do banco;
- foram apontadas ainda 31 foreign keys sem índice de cobertura no schema legado. Esse achado é informativo para o legado e não substitui a validação do schema CURRENT, cujo fresh install é certificado no CI.

Nenhum `prisma migrate deploy` foi executado sobre esse banco legado para evitar aplicar uma longa cadeia de migrations sobre uma superfície externa insegura sem antes resolver a exposição Data API/RLS.

### Railway

O único projeto Railway conectado na conta durante a auditoria pertence ao Kordena/FM AI Platform e foi explicitamente excluído do escopo IRON. Nenhuma mutação foi feita nele.

### GitHub

Os repositórios retornaram lista de rulesets vazia. O endpoint clássico de branch protection não é legível pela instalação GitHub disponível (403 administrativo), portanto proteção de `main` **não é declarada como comprovada**.

### Status de homologação física

- runtime IRON externo: NÃO COMPROVADO;
- banco homolog CURRENT: BLOQUEADO pelo drift/risco do Supabase legado;
- produção IRON: NÃO DECLARADA;
- CI com PostgreSQL real fresh-install + container build: COMPROVADO internamente.

Esses itens só podem ser promovidos com nova evidência física.
