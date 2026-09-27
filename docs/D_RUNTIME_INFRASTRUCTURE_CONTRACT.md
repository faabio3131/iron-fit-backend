# IRON — Macrobloco D — Runtime / Infra DEV-HOMOLOG-PROD

Status: **IN_PROGRESS — engenharia interna candidata; ambientes físicos ainda exigem evidência externa**

## Objetivo

D exige a mesma aplicação e arquitetura em DEV, HOMOLOG e PROD, variando apenas configuração, escala e recursos físicos.

Este contrato não cria uma segunda stack de produção.

## Runtime authority

`IRON_RUNTIME_ENV` é obrigatório e aceita somente:

- `DEV`;
- `HOMOLOG`;
- `PROD`.

Em `PROD`:

- `NODE_ENV=production` é obrigatório;
- `INTEGRATION_SECRET_VAULT_BACKEND=OCI` é obrigatório;
- billing `INTERNAL_SANDBOX` é proibido;
- sandbox de billing habilitado é proibido.

Em runtime production-shaped de HOMOLOG/PROD:

- `IRON_BUILD_SHA` é obrigatório;
- `WEB_APP_URL` deve ser HTTPS;
- todas as origens de `CORS_ORIGINS` devem ser HTTPS;
- `OBSERVABILITY_METRICS_TOKEN` deve possuir pelo menos 32 caracteres.

`DATABASE_URL` é obrigatório em qualquer runtime.

## Identidade operacional

Health/readiness/logs expõem somente metadados seguros:

- serviço;
- DEV/HOMOLOG/PROD;
- NODE_ENV;
- build SHA;
- release version quando configurada.

Nenhum segredo é emitido.

## Observabilidade

Base interna:

- liveness independente de banco;
- readiness com query física `SELECT 1`;
- request/correlation ID;
- log HTTP estruturado;
- request count;
- 5xx count;
- latência agregada;
- memória/process uptime;
- endpoint de métricas sem dimensão tenant/user.

Em `NODE_ENV=production`, `/api/v1/health/metrics` exige Bearer token global de observabilidade.

## Web

O Web continua sendo o mesmo artefato Expo exportado em container.

`EXPO_PUBLIC_API_URL` é build-time público e não contém segredo.

A URL física final de cada ambiente precisa ser comprovada no D/F, não inferida por documentação.

## Deploy

O backend continua:

- Node 22;
- Docker multi-stage;
- usuário não-root;
- Prisma generate no build;
- `prisma migrate deploy` no pre-deploy;
- healthcheck em `/api/v1/health/ready`;
- restart controlado.

## Limite do gate

A engenharia deste WP pode ser certificada por CI.

O **Gate D não passa** até existirem evidências físicas separadas de DEV, HOMOLOG e PROD com:

- runtime acessível;
- Web acessível;
- banco correspondente;
- configuração segregada;
- health/readiness verdes;
- build SHA identificável;
- observabilidade operacional;
- secrets globais configurados fora do repositório.

Nenhuma URL ou ambiente físico será inventado.
