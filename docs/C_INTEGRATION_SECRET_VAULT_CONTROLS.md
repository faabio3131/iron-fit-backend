# IRON — Commercial Readiness — Secret Vault Controls

Status: **INTERNAL CONTROLS CERTIFIED — C4 PHYSICAL VAULT BLOCKED_EXTERNAL**

Current main: `60d28300a8466c26574af08970dde17e97761442`

Evidence:
- PR #66;
- first PR CI `36325413341` correctly FAILED on two historical audit-source expectations after the redaction refactor; no promotion occurred;
- corrective PR CI `36325557481` — SUCCESS;
- post-merge main CI `36325717270` — SUCCESS;
- secret scan: PASS across 601 tracked files;
- smoke regression: 460/460 PASS, 0 FAIL, 0 SKIP;
- B6 integrated live E2E: 5/5 PASS, 0 FAIL, 0 SKIP;
- cross-surface live app client and production container build: SUCCESS.

Baseline C1-C3: certified on main at `bb6fb4944089e3e1522669c2b101c1435542db80`.

## Estado de C4

C4 — Vault Backend físico — está **BLOCKED_EXTERNAL** até que um backend gerenciado real de segredos seja selecionado, provisionado e governado.

Nenhuma coluna do PostgreSQL, `.env` por cliente, criptografia caseira ou adapter fake pode ser promovido como Vault físico.

O runtime mantém um adapter explicitamente indisponível por padrão.

## Controles certificados neste incremento

### C5 — boundary/resolver interno certificado; backend físico pendente

`IntegrationSecretValue` não revela conteúdo por conversão para string, serialização JSON ou inspeção Node. Cleartext só existe por chamada explícita a `reveal()`, destinada ao último boundary do adapter externo.

Antes de qualquer leitura do Vault, o resolver valida:
- connection id canônico;
- GLOBAL/TENANT;
- gymId no escopo TENANT;
- environment exato;
- status ACTIVE;
- referência e versão;
- revogação e expiração.

Cross-tenant denial ocorre antes de qualquer Vault read. Revogação/expiração concorrente após a leitura física bloqueia a entrega antes do reveal.

### C8 — lifecycle metadata certificado; escrita/rotação física pendente C4/C6

PostgreSQL persiste somente metadados não secretos:
- secretVersion;
- secretRotatedAt;
- secretExpiresAt;
- secretLastUsedAt;
- secretRevokedAt.

Constraints impedem estados parciais incompatíveis.

### C9 — structural redaction CERTIFIED

Audit redaction normaliza camelCase, snake_case e nomes equivalentes e cobre passwords, tokens, secrets, API keys, private keys, authorization, card PAN/CVV/CVC e secretReference recursivamente.

Os nomes históricos exigidos pelos gates B4/S11 permanecem explícitos e funcionais.

### C10 — environment isolation CERTIFIED

`IRON_RUNTIME_ENV` é obrigatório e aceita apenas DEV, HOMOLOG ou PROD. Secret resolution filtra pelo ambiente exato; credencial PROD não pode ser selecionada por runtime DEV/HOMOLOG.

### C12 — adversarial resolver isolation CERTIFIED

Testes permanentes provam que tenant forjado é rejeitado antes de acessar o backend físico de segredo.

### C13 — repository secret scanning CERTIFIED

O quality gate executa `scripts/secret-scan.mjs` antes de build/testes e bloqueia:
- private keys de alto sinal;
- formatos conhecidos de credenciais live;
- arquivos `.env` rastreados, exceto `.env.example`.

## Ainda não concluído

- C4 — physical Vault backend: BLOCKED_EXTERNAL;
- C6 — write-only create/replace/test/rotate/revoke admin API/UX;
- C7 — step-up wiring das operações críticas (o B4 já fornece `assertStepUp`);
- C8 — escrita/rotação/revogação física no Vault;
- C11 — política física de backup/recovery do Vault;
- C14 — fluxo operacional break-glass;
- providers reais.
