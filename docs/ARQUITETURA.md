# IRON Fit — Arquitetura CURRENT

**Status:** engenharia interna certificada até o Bloco 6; produção externa **não declarada**  
**Linha canônica:** `main`  
**Backend:** `faabio3131/iron-fit-backend`  
**App Web/mobile:** `faabio3131/iron-fit-app`  
**Data de reconciliação:** 27/09/2026

> Este documento descreve o CURRENT técnico. Claims históricos de Render/Supabase como produção, painel React/Vite paralelo, `/auth/register` público e runtime `dist/main` foram removidos porque não representam mais a aplicação canônica.

## 1. Arquitetura única

O IRON mantém uma única linha de produto:

```text
Web (Expo + React Native Web) ─┐
                              ├──> API NestJS ──> PostgreSQL
Mobile (Expo / React Native) ─┘
                                      │
                                      ├── Auth / Session / RBAC / Tenant
                                      ├── Product / Plan / Feature
                                      ├── Trial / Onboarding
                                      ├── Operações da academia
                                      ├── Billing SaaS FM -> academia
                                      ├── Aggregator Hub
                                      ├── Creator Network
                                      └── IRON Intelligence (governado)
```

Web e mobile pertencem ao mesmo repositório `iron-fit-app`, compartilham o mesmo cliente HTTP e consomem as mesmas autoridades de backend. Não existe um segundo painel Web com regras de negócio próprias.

## 2. Stack CURRENT

### Backend
- Node.js 22.
- NestJS 11.
- TypeScript 5.7.
- Prisma 6.19.3.
- PostgreSQL.
- Dockerfile versionado.
- processo de produção: `node dist/src/main.js`.

### App
- Expo SDK 57.
- React 19.
- React Native 0.86.
- React Native Web.
- Android e Web exportados/certificados pelo CI.
- Web empacotada em container de produção e submetida a smoke físico de runtime.

## 3. Autoridades canônicas

### Identidade e segurança
- `User`, `Session`, `UserRole`/RBAC e tenant context são autoridades.
- access JWT carrega `sid`; a sessão é validada no servidor.
- refresh token é rotativo e armazenado por hash.
- MFA TOTP, recovery codes, step-up, rate limit e action tokens pertencem ao backend.
- cadastro público comercial canônico: `POST /commercial/trial/start`.
- `/auth/register` não é a superfície pública comercial.

### Tenant
- tenant ativo deriva da identidade/sessão autenticada.
- domínio não confia em `gymId` arbitrário do cliente para operações tenant-scoped.
- isolamento cross-tenant é requisito permanente de regressão.

### Comercial
- `ProductPlan` / versões / features definem catálogo de produto.
- `TenantProductSubscription` é a autoridade de entitlement.
- trial e onboarding zero-touch usam as autoridades canônicas existentes.
- `SaasBillingAgreement` registra lifecycle financeiro/comercial e não substitui entitlement.

## 4. Superfícies

### Web operacional
A Web cobre os domínios comerciais e operacionais canônicos, incluindo onboarding, equipe, alunos, equipamentos, avaliações, treinos, agenda, acesso, financeiro, assinatura IRON, segurança e entitlements.

Equipamentos novos devem seguir o Catálogo Mestre:
- seleção: `POST /equipments/catalog/selection`;
- candidate intake quando o item não existe;
- criação manual legada não é o caminho canônico para novos itens.

### Mobile
O aluno usa as rotas canônicas `/me/*` para perfil, treinos, avaliações, agenda e cobranças.

## 5. Billing

Existem dois domínios distintos:

1. **FM -> academia:** billing SaaS da assinatura IRON.
2. **Academia -> aluno:** financeiro operacional do tenant.

O motor SaaS interno está certificado com provider `INTERNAL_SANDBOX`, que é proibido em produção. Nenhum gateway externo é declarado homologado até o bloco de Commercial Readiness correspondente.

## 6. Providers e integrações

Adapters e contratos são provider-neutral sempre que aplicável.

Estado atual:
- Wellhub/TotalPass: fronteiras internas existem; homologação externa depende de documentação/credenciais oficiais.
- IRON Intelligence: configuração GLOBAL/TENANT e `secretReference` existem; secret backend real ainda precisa ser materializado no Integration & Secret Vault.
- Creator media: provider abstraction existe; provider live de storage/CDN não é declarado.
- e-mail: emissão segura de action token existe; entrega real depende de provider homologado.

Nenhum provider externo é considerado live apenas porque existe adapter, contrato ou configuração candidata.

## 7. Runtime e infraestrutura

A aplicação possui fundação production-shaped:
- Docker;
- `railway.toml` candidato;
- `prisma migrate deploy`;
- liveness;
- readiness com consulta real ao PostgreSQL;
- métricas agregadas;
- logs HTTP estruturados com request ID;
- CORS e proxy topology configuráveis.

### Estado externo conhecido
- não existe runtime IRON Railway comprovado;
- o Supabase `gym-saas` observado é legado e não representa o schema CURRENT;
- produção IRON não está declarada.

DEV, HOMOLOG e PROD deverão executar a mesma aplicação e arquitetura, variando somente configuração, secrets, endpoints e capacidade.

## 8. Banco e migrations

Fonte de verdade:
- `prisma/schema.prisma` e schemas Prisma complementares;
- `prisma/migrations`.

O CI executa PostgreSQL real e `prisma migrate deploy` do zero. Isso comprova fresh install interno, mas não substitui homologação física de banco externo, backup/restore e disaster recovery.

## 9. CI e certificação

O backend quality gate executa, no mínimo:
1. `npm ci`;
2. dependency audit;
3. Prisma generate;
4. fresh migrations em PostgreSQL real;
5. lint/typecheck;
6. build;
7. regressão;
8. seed determinístico B6;
9. backend real;
10. Integrated Live E2E;
11. checkout de SHA explícito do app certificado;
12. cliente real do app contra o backend;
13. build do container backend.

O app executa dependency audit, typecheck, lint, Jest, release/build checks, export Android, export Web, integridade de bundles, build do container Web e smoke físico de `/health` + `index.html`.

## 10. Estado dos Blocos 4–6

- **Bloco 4 — Identidade e Segurança Comercial:** implementação interna concluída e mergeada; provider externo de e-mail continua dependência de homologação.
- **Bloco 5 — Infraestrutura:** engenharia interna concluída; homologação externa/produção pendente.
- **Bloco 6 — Recertificação Integrada:** certificado internamente com PostgreSQL real em CI e transporte HTTP real entre app e backend.
- **Macrobloco A de Commercial Readiness:** repina o B6 para o app CURRENT saneado e reconcilia documentação.

## 11. Claims proibidos sem evidência

Não declarar, sem evidência física atual:
- “produção live”;
- banco externo homologado;
- gateway real homologado;
- Wellhub/TotalPass live;
- provider de IA live;
- storage/CDN live;
- e-mail live;
- disponibilidade comercial final.

## 12. Próxima fase

Após o Macrobloco A, seguir o Cronograma Mestre de Execução Commercial Readiness A–T.

O **Integration & Secret Vault** é P0 e deve anteceder integrações específicas de cliente que carreguem credenciais, OAuth tokens, webhook secrets ou material financeiro sensível.
