# IRON FIT CORE — AI-GAP-1 — AI Content Recommendation

Status: **CANDIDATE — runtime interno implementado; provider real permanece dependência de homologação P5/K1**

## Gap reconciliado

A Launch Matrix V1 e os planos IRON V1/TRIAL concedem `ai.content_recommendation`, e a infraestrutura AI/Vault já reconhecia a capability `CONTENT_RECOMMENDATION`. Porém não existia caso de uso HTTP que executasse essa capability.

## Implementação

Foi adicionado `POST /me/ai/content-recommendations`, exclusivo do perfil STUDENT autenticado.

Fluxo:

1. tenant e usuário vêm exclusivamente da sessão/JWT;
2. `AiPolicyGuardService` exige entitlement efetivo `ai.content_recommendation`;
3. o backend carrega apenas exercícios dos treinos `ACTIVE`/`APPROVED` do próprio aluno no tenant;
4. somente exercícios com conteúdo elegível segundo `ExerciseContentPublishingService` entram no contexto do modelo;
5. o modelo recebe IDs e metadados mínimos; a URL não é autoridade do modelo;
6. a execução usa `CONTENT_RECOMMENDATION` e o prompt versionado `student.content_recommendation@1`;
7. a saída passa pelo `AiOutputValidatorService`, que rejeita URLs inventadas e mutações de autoridade;
8. cada `exerciseId` retornado é validado contra o conjunto canônico;
9. o conteúdo final é resolvido novamente pelo backend, depois da IA, usando a política de conteúdo e os entitlements vigentes.

## Autoridade preservada

A IA apenas ordena/sugere entre candidatos canônicos. Ela não publica conteúdo, não cria direitos/licenças, não escolhe conteúdo fora do treino do aluno, não inventa URL, não amplia entitlement, não altera treino e não concede acesso.

## Estado do provider

O runtime provider-neutral está implementado e fail-closed. A homologação física continua condicionada ao K1/P5: provider/model reais, `IntegrationConnection` correspondente, segredo no Vault e execuções controladas em HOMOLOG.

Até essa evidência externa, o runtime pode retornar indisponibilidade segura; isso não deve ser representado como provider homologado.
