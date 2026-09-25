# IRON M5 — Trial, Provisioning e Onboarding Zero-Touch

Status: **CANDIDATE — IMPLEMENTAÇÃO INTERNA EM CERTIFICAÇÃO**

## Objetivo

Fechar a primeira jornada comercial zero-touch do IRON sem criar uma segunda autoridade de planos, tenant, autenticação ou auditoria.

Fluxo canônico:

visitante → trial → User/OWNER → Gym → TenantProductSubscription → autenticação → onboarding.

## Autoridades reutilizadas

- User/Auth/RBAC existentes continuam autoridade de identidade e autorização.
- Gym continua autoridade de tenant.
- ProductPlanVersion/TenantProductSubscription PE0-PE4 continuam autoridade comercial de entitlement.
- AuditLog continua trilha de auditoria; não é mecanismo de idempotência.
- CommercialTrialProvisioning é a barreira física exclusiva de idempotência do requestId do signup.

## Idempotência e concorrência

O provisionamento executa em transação Serializable. requestId possui chave primária física em CommercialTrialProvisioning.

O fingerprint contém somente dados de negócio normalizados não secretos. Reuso do mesmo requestId com dados diferentes falha fechado. A senha bruta não é persistida no registro de idempotência nem no AuditLog.

A unicidade física do requestId impede dois provisionamentos canônicos para a mesma intenção. Uma transação concorrente perdedora é revertida integralmente pelo banco e pode repetir para recuperar o resultado canônico.

## Trial efetivo

TenantProductEntitlements somente considera assinatura ACTIVE dentro de effectiveFrom/effectiveUntil. Assim, uma assinatura temporal vencida deixa de conceder capabilities mesmo antes da materialização do status.

CommercialTrialService é a autoridade para materializar a expiração em SUSPENDED e emitir COMMERCIAL_TRIAL_EXPIRED.

JWT permanece autoridade de autenticação e contexto; não altera estado comercial.

## Onboarding

Ordem:

1. ACADEMY_PROFILE
2. EQUIPMENT_INVENTORY
3. TEAM_REVIEW
4. FINISH

Leitura dos checkpoints e gravação da próxima etapa ocorrem na mesma transação Serializable. Replay da etapa concluída é idempotente e avanço fora de ordem falha fechado.

## CI

O workflow canônico cobre main, stabilization/**, feat/** e fix/** para impedir que branches normais de implementação fiquem fora do quality gate.

## Superfície comercial

O backend M5 expõe trial/start, trial/status e onboarding. A jornada Web completa pertence ao Bloco 2 e não é considerada entregue por este documento.

## Gate de saída

A promoção de M5 exige:

- npm audit --audit-level=high;
- Prisma generate;
- lint/typecheck;
- build;
- regressão integral;
- matriz M5 permanente;
- CI de branch verde;
- CI de PR verde;
- mergeability clean;
- merge;
- CI pós-merge verde.

Este documento não autoriza declarar o IRON comercialmente disponível.
