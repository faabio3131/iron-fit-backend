# IRON-AI0 G5 — Mobile Advisory Surface

## Escopo

G5 ativa somente a superfície advisory já prevista e já consumida pelo app certificado:

- `POST /me/ai/workout-insights`
- `POST /me/ai/chat`

Os dois endpoints são STUDENT-only, usam JWT/Roles canônicos e nunca recebem tenant autoritativo do payload. O tenant é derivado exclusivamente da identidade autenticada (`activeGymId ?? gymId`).

## Contexto e política

O payload `context` do mobile é aceito apenas para compatibilidade de wire e deliberadamente ignorado como fonte de autoridade. O backend reconstrói o contexto via `AiContextBuilderService` sobre dados canônicos do tenant e passa pelo `AiPolicyGuardService`/entitlements antes de qualquer execução.

Dados de saúde permanecem fora do contexto advisory de G5 (`includeHealthData: false`). Entrada textual e contexto canônico passam pelo sanitizer antes da fronteira do provider.

## Fail-open do mobile / fail-closed de autoridade

Entitlement ausente continua falhando fechado no backend. Configuração/provider/budget/timeout indisponíveis são normalizados pelo runtime e expostos como `503 AI_ADVISORY_UNAVAILABLE`, sem providerCode, modelCode, endpoint ou secret. O app já captura erro/timeout/indisponibilidade e retorna o fallback estático local, portanto a jornada de treino permanece fail-open sem transformar a IA em autoridade determinística.

Output SUCCEEDED ainda passa pelo `AiOutputValidatorService`. URLs, mutações de autoridade, equipamentos incompatíveis e conteúdo inelegível continuam rejeitados. O G5 somente normaliza resposta advisory para o wire contract já aceito pelo app.

## Limites preservados

- nenhuma credencial/provider secret chega ao mobile;
- nenhum provider comercial é ativado;
- nenhuma mutação de treino, prescrição ativa ou aprovação ocorre;
- nenhuma migration nova é necessária;
- nenhum `gymId` do body/query é aceito como autoridade;
- G6/workout candidate não foi iniciado.
