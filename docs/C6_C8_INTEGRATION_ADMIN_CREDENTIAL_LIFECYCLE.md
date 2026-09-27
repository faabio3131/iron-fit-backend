# IRON — Commercial Readiness — C6/C7/C8 Integration Admin Credential Lifecycle

Status: **CANDIDATE — aguardando CI/PR/merge/post-merge**

## Objetivo

Entregar a API administrativa write-only para credenciais de integração, sem transformar banco, frontend ou payloads de tenant em autoridade de segredo.

## Autoridades

Tenant:
- somente OWNER;
- tenant vem de activeGymId/gymId autenticado;
- nenhuma rota aceita gymId do body;
- environment vem de IRON_RUNTIME_ENV;
- provider precisa estar autorizado por FEATURE entitlement efetivo do plano/configuração do tenant.

Global:
- somente SUPER_ADMIN;
- scope GLOBAL;
- environment também vem do runtime.

## Step-up

Create, replace, rotate, test e revoke exigem AuthSecurityService.assertStepUp:
- senha atual;
- MFA TOTP ou recovery code quando MFA estiver habilitado.

Não existe segundo mecanismo de reautenticação.

## Write-only

O body de create/replace/rotate contém secretValue apenas na entrada.

Respostas administrativas nunca retornam:
- secretValue;
- secretReference;
- raw token/API key;
- conteúdo recuperado do Vault.

A view segura retorna apenas metadados: provider, status, capabilities, configuração pública, credentialConfigured, versão, rotação, expiração, último uso, revogação e última verificação.

## Rotação segura

A rotação não sobrescreve primeiro o segredo canônico.

Fluxo:
1. cria uma nova secretReference opaca;
2. grava o novo segredo físico no Vault;
3. troca atomicamente o ponteiro canônico no PostgreSQL somente se a referência/versão antiga ainda forem as esperadas;
4. agenda a revogação física da referência anterior.

Se o passo 3 falhar, o segredo novo é revogado e o canonical state permanece intacto.

Se a limpeza do segredo antigo falhar depois da troca, o segredo antigo não é mais alcançável pelo resolver e é registrado INTEGRATION_OLD_SECRET_CLEANUP_PENDING.

## Revoke fail-closed

A revogação marca primeiro PostgreSQL como DISCONNECTED + secretRevokedAt.

Somente depois agenda a revogação física no Vault.

Assim, falha de rede com OCI não reabre a credencial antiga para uso pelo IRON.

## Test credential

A API exige um IntegrationCredentialProbe provider-specific.

Sem probe registrado, test falha fechado e lastVerifiedAt não é promovido.

O segredo é resolvido pelo boundary C5 e entregue como IntegrationSecretValue somente ao probe.

## Relação com planos comerciais

Cada provider tenant-facing precisa declarar tenantEntitlementFeatureKey.

Exemplo conceitual:
- Wellhub -> aggregator.wellhub;
- TotalPass -> aggregator.totalpass;
- provider de IA -> capability configurada do domínio AI;
- gateway aluno -> capability comercial correspondente quando formalizada.

A existência de adapter no código não concede acesso ao tenant.

## Pendências fora deste incremento

- UI premium de configuração;
- probes reais de providers específicos;
- provisionamento físico OCI/IAM;
- C11 DR/backup físico;
- C14 break-glass;
- homologação real dos providers.
