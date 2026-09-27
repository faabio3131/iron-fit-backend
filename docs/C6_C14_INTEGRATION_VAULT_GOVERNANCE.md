# IRON — Commercial Readiness C6-C14 — Vault Governance

Status: **CANDIDATE INTERNO — C6-C14**

Este incremento completa a governança do Integration & Secret Vault sem ativar nenhum provider externo.

## C6 — Write-only Admin API
A superfície administrativa permite listar providers e metadados, criar conexão GLOBAL/TENANT, alterar apenas configuração pública permitida, gravar/rotacionar/verificar/revogar segredo. Não existe endpoint GET/reveal/download de plaintext, referenceId ou caminho físico do Vault.

A UX funcional deve consumir esta API sem armazenar segredo localmente.

## C7 — Step-up e MFA
Toda mutação crítica reutiliza AuthSecurityService.assertStepUp: senha atual é obrigatória e, quando MFA estiver habilitado, TOTP ou recovery code também é obrigatório.

OWNER opera somente conexões TENANT derivadas da sessão autenticada. SUPER_ADMIN opera conexões GLOBAL. gymId não existe nos DTOs.

## C8 — Lifecycle
Cada segredo possui versão monotônica, createdAt, rotatedAt, expiresAt, lastUsedAt, lastVerifiedAt, revokedAt e status.

Rotação grava nova referência, promove uma nova versão e revoga versões anteriores. Falha de limpeza física da versão anterior degrada a conexão e gera auditoria explícita.

Revogação destrói material no OpenBao antes de promover metadata para REVOKED.

## C9 — Audit & Redaction
AuditLog recebe somente metadata. O sanitizador cobre camelCase, snake_case e variantes normalizadas para API keys, OAuth tokens, client secrets, webhook secrets, private keys, certificados, CVV e PAN/card number.

## C10 — Environment Isolation
DEV, HOMOLOG e PROD são namespaces independentes. A API administrativa só opera conexão cujo environment coincide com INTEGRATION_RUNTIME_ENV.

## C11 — Backup / DR
O backup do banco operacional contém metadata e referências opacas. Esse backup **nao restaura nenhum segredo reutilizavel**.

O OpenBao deve possuir backup/snapshot e restore próprios em D. O restore drill deve provar banco operacional, OpenBao, policies/auth method, workload identity least-privilege, resolução no mesmo ambiente/tenant e smoke pós-restore.

Sem restore drill físico, produção continua bloqueada por D.

## C12 — Adversarial Tenant Isolation
Gates tentam connectionId de outro tenant, tenant/body/header forjado, provider divergente, referência de outro escopo, cross-environment e segredo expirado/revogado.

Tenant A jamais pode causar leitura, troca, verificação ou uso do segredo de Tenant B.

## C13 — Secret Scanning
CI executa scripts/secret-scan.mjs. Padrões de credenciais conhecidas e private keys bloqueiam o pipeline. Isso complementa o Vault e o secret scanning nativo da hospedagem quando habilitado.

## C14 — Break-glass
Não há leitura cotidiana de plaintext nem para SUPER_ADMIN. Procedimento normal de incidente: **rotate/revoke**.

Qualquer break-glass humano futuro deve ocorrer fora da API do IRON, exigir aprovação formal, IAM temporário com TTL mínimo, limitar path/tenant/provider, produzir audit trail no Vault/infra, revogar sessão/capability ao final e obrigar rotação posterior.

Este documento não autoriza break-glass produtivo; homologação física pertence a D/M.

## Gate C
O Gate C final exige C1-C14 verdes, CI branch/PR/main, API write-only, step-up/MFA, adversarial cross-tenant PASS, secret scan PASS, OpenBao real em CI, nenhuma credencial de cliente no banco operacional, nenhum provider falsamente live e UX funcional no app/Web.
