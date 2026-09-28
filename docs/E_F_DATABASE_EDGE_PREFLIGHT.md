# IRON — W2/W3 — Database CURRENT + Public Edge Preflight

Status: **CERTIFIED_INTERNAL / PHYSICAL_PENDING**

Atualizado em: 2026-09-28

## Objetivo

Fechar tudo que é possível dos Macroblocos E e F antes da existência dos ambientes físicos oficiais, sem inventar banco, domínio, TLS ou homologação externa.

## Macrobloco E — Database CURRENT

### Evidência interna já comprovada

O Quality Gate oficial executa em PostgreSQL real e efêmero:

- `prisma generate`;
- `prisma migrate deploy` em banco fresco;
- `prisma migrate status`;
- build/typecheck;
- regressão completa;
- backup via `pg_dump`;
- restore em banco separado;
- verificação pós-restore;
- readiness com `SELECT 1`.

Isso comprova:

- cadeia de migrations executável do zero;
- schema CURRENT instalável em PostgreSQL limpo;
- backup lógico reproduzível;
- restore em banco separado;
- DB backup sem segredo reutilizável do Integration Secret Vault.

### Limite do Gate E

E **não passa fisicamente** até existir um PostgreSQL oficial por ambiente aplicável, com:

- DEV/HOMOLOG/PROD segregados;
- CURRENT instalado por migrations oficiais;
- conectividade real;
- baseline de performance;
- política de backup do provider;
- retenção;
- restore drill físico;
- evidência registrada.

O Supabase legado `gym-saas` não deve ser promovido como CURRENT apenas por existir.

## Macrobloco F — Web/API/DNS/TLS

Foi adicionado o comando:

```bash
npm run readiness:edge-preflight
```

Variáveis obrigatórias:

- `IRON_PUBLIC_API_URL`;
- `IRON_PUBLIC_WEB_URL`;
- `IRON_EXPECTED_BUILD_SHA`;
- `IRON_EXPECTED_RUNTIME_ENV=HOMOLOG|PROD`;
- opcional `IRON_EDGE_PREFLIGHT_TIMEOUT_MS`.

O preflight é propositalmente físico. Ele não aceita HTTP e não possui modo fake.

### Evidências exigidas pelo preflight

1. API URL absoluta HTTPS;
2. Web URL absoluta HTTPS;
3. DNS da API resolve;
4. DNS da Web resolve;
5. HTTPS fetch da API valida TLS pela pilha Node;
6. HTTPS fetch da Web valida TLS;
7. `/api/v1/health/live` responde 2xx;
8. liveness reporta o `runtimeEnvironment` esperado;
9. liveness reporta exatamente o `buildSha` esperado;
10. `/api/v1/health/ready` responde 2xx;
11. readiness reporta PostgreSQL `up`;
12. CORS OPTIONS aceita exatamente a origem da Web oficial;
13. `access-control-allow-credentials=true`;
14. Web responde 2xx com conteúdo HTML/XHTML.

### Exemplo de execução em HOMOLOG

```bash
IRON_PUBLIC_API_URL=https://api-homolog.exemplo.com \
IRON_PUBLIC_WEB_URL=https://app-homolog.exemplo.com \
IRON_EXPECTED_BUILD_SHA=<sha-da-main> \
IRON_EXPECTED_RUNTIME_ENV=HOMOLOG \
npm run readiness:edge-preflight
```

## Regra de promoção

Resultado do script em CI local ou contra mock não fecha F.

Gate F só pode receber evidência quando o comando for executado contra as URLs oficiais do ambiente físico correspondente e retornar:

`iron_public_edge_preflight_pass`.

Nenhum domínio, certificado ou URL é declarado existente por este documento.
