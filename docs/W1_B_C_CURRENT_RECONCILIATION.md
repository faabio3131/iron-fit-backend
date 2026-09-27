# IRON — W1 / Macroblocos B + C — Reconciliação CURRENT

Atualizado em: 2026-09-27  
Backend CURRENT base: `9fc0eab252b8f06cd24354fa23e75084f7eaea54`  
App CURRENT certificado e repinado no B6: `3b0f91e109e31457f903f95182f04d2079349e9b`

## Regra de status

Este documento reconcilia evidência real com o Cronograma Mestre.  
`CERTIFIED_INTERNAL` não significa homologação física, provider real ou produção.

## Macrobloco B — Congelar escopo comercial V1

Status: **IN_PROGRESS — GATE B OPEN**

Fundação já disponível:
- catálogo de capabilities persistente e governado;
- ProductPlan + ProductPlanVersion;
- entitlements versionados;
- versão publicada imutável;
- TenantProductSubscription;
- configuração tenant que somente estreita autoridade;
- preferência de usuário que somente estreita autoridade;
- pricing SaaS persistente por planVersion;
- integração tenant condicionada a entitlement comercial efetivo;
- nenhum módulo precisa depender de nome comercial de plano.

Ainda obrigatório para fechar B:
- Launch Capability Matrix formal, versionada e aprovada;
- Core/Web/E-mail/Billing classificados como LAUNCH conforme Cronograma Mestre;
- decisão humana sobre Android/iOS;
- decisão humana sobre AI, Creator Network, Wellhub, TotalPass, Meta/Google e demais canais;
- modelo fiscal V1 definido;
- catálogo comercial efetivo congelado: planos/preços/trial/limites/upgrade/downgrade/cancelamento/refund/grace period;
- tudo OUT comprovadamente fail-closed.

Nenhuma dessas decisões pendentes será inventada pelo código.

## Macrobloco C — Integration & Secret Vault

Status: **IN_PROGRESS / BLOCKED_EXTERNAL — GATE C OPEN**

| WP | Estado CURRENT | Evidência / limite |
|---|---|---|
| C1 Provider Registry | CERTIFIED_INTERNAL | Registry provider-neutral persistido no runtime e catálogo seguro. |
| C2 Connection Authority | CERTIFIED_INTERNAL | GLOBAL/TENANT + gymId + provider + environment; lookup scoped/fail-closed. |
| C3 Secret Reference | CERTIFIED_INTERNAL | `isv_...` opaca; DB sem valor reutilizável. |
| C4 Vault Backend | BLOCKED_EXTERNAL | Adapter OCI integrado, mas Vault/KMS/IAM real ainda não foi fisicamente provisionado/homologado. |
| C5 Secret Resolver | CERTIFIED_INTERNAL | Resolve server-side, valida scope/env/status/version/revogação/expiração; physical backend depende de C4. |
| C6 Write-only Admin UX/API | CERTIFIED_INTERNAL | API + Web OWNER; create/replace/rotate/verify/revoke; sem reveal; provider verify exige probe. |
| C7 Step-up & MFA | CERTIFIED_INTERNAL | Mutação de credencial reutiliza AuthSecurityService; break-glass exige MFA obrigatório. |
| C8 Lifecycle | CERTIFIED_INTERNAL | version/rotated/expires/lastUsed/lastVerified/revoked + cleanup persistente; operação física OCI não homologada. |
| C9 Audit & Redaction | CERTIFIED_INTERNAL | Sanitização estrutural + audit sem segredo. |
| C10 Env Isolation | CERTIFIED_INTERNAL / PHYSICAL_PENDING | Runtime DEV/HOMOLOG/PROD fail-closed; namespaces/chaves físicas distintas dependem do C4/D. |
| C11 Backup/DR Secret Policy | CERTIFIED_INTERNAL / PHYSICAL_PENDING | pg_dump → restore real em CI prova DB sem segredo reutilizável e resolver sem Vault falha fechado; recovery físico OCI depende C4/D/E. |
| C12 Adversarial Tenant Isolation | PARTIAL_CERTIFIED | Resolver/admin/connection cross-tenant cobertos. Callback/webhook adversarial só pode fechar com H/I implementados e homologados. |
| C13 Secret Scanning CI | CERTIFIED_INTERNAL | Gate permanente antes de build/testes. |
| C14 Break-glass | CERTIFIED_INTERNAL / PHYSICAL_PENDING | dual control, MFA, TTL 60–900s, one-shot provider verify; uso real depende C4/provider homologado. |

## Evidências principais

- C1–C3: PR #65; branch CI `36324690273`; post-merge `36324876224`.
- C5/C8/C9/C10/C12/C13 base: PR #66; corrected CI `36325557481`; post-merge `36325717270`.
- C4A OCI adapter: PR #68; CI `36330980382`; post-merge `36331142128`.
- C6/C7/C8 hardening: PR #73; CI `36343326139`; post-merge `36343905388`.
- C6 Web UX contract hardening: app PR #20; CI `36344168188`; post-merge `36344465339`.
- B6 repin para app C6: PR #74; CI `36344645608`; post-merge `36345345704`.
- C11: PR #75; CI `36345923486`; post-merge `36346089382`.
- C14: PR #76; corrected CI `36346778136`; post-merge `36347003093`.

## Gate W1

**FAIL / OPEN**, corretamente.

Motivos:
1. Gate B ainda exige Launch Capability Matrix aprovada e congelamento comercial.
2. Gate C exige Vault real e isolamento físico/lógico; C4 permanece BLOCKED_EXTERNAL.
3. C12 callback/webhook adversarial depende das superfícies H/I.

## Trabalho independente liberado

O Cronograma Mestre define D com dependência em A, e determina que blocker externo não deve apagar nem impedir trabalho independente.

Portanto:
- B pode continuar até o ponto de decisão humana;
- D pode avançar em preparação/contratos/IaC/observabilidade sem declarar ambiente físico homologado;
- E somente fecha depois de D físico;
- G/H/I/K não podem ser homologados como provider real antes do Gate C.
