# IRON-AI0 G3 — Context Safety, Policy & Tenant Isolation

## Escopo

G3 cria a fronteira de segurança entre os fatos determinísticos do IRON e qualquer provider futuro. Nenhum provider, SDK, segredo real ou endpoint `/me/ai/*` é introduzido.

## Context Builder por allowlist

O contexto de aluno é construído por `select` explícito do Prisma, nunca por serialização de objetos `Student`/`Assessment` completos. O tenant e o usuário são parâmetros internos obrigatórios. A consulta do aluno é simultaneamente filtrada por `gymId`, `userId` e status ACTIVE.

São projetados apenas objetivo/nível, histórico resumido de até cinco treinos e inventário ativo do tenant. Dados de saúde da última avaliação só entram quando a capability realmente solicita esse contexto **e** `consentHealth=true`; notas e measurements brutos não são enviados.

## Sanitização de defesa em profundidade

Além da allowlist estrutural, `AiSanitizerService` remove chaves e padrões associados a tokens, credenciais, cookies/JWT, senhas, API keys/secrets, financeiro, cartão, Pix e fiscal, limita profundidade/arrays/strings e redige Bearer/JWT/segredos inline.

## Policy Guard

Antes de uma futura chamada externa a capability deve possuir tenant, usuário, finalidade exata e entitlement efetivo. `WORKOUT_GENERATION` usa `ai.workout_generation`; `WORKOUT_INSIGHTS`, `ADVISORY_CHAT` e `CONTENT_RECOMMENDATION` usam `ai.content_recommendation`, sem inventar nova chave de produto dentro do AI0.

Para STUDENT o resolvedor canônico `resolveFeatureForUser` preserva PLAN → TENANT → USER e fail-closed. Para contexto não estudante usa-se `resolveFeature`.

## Equipment e Creator permanecem soberanos

G3 não copia regras de compatibilidade nem rights/publishing. `AiOutputValidatorService` delega equipamento a `EquipmentsService.findCompatibleForExercise()` e conteúdo a `ExerciseContentPublishingService.resolveExerciseContent()`.

A saída do modelo não pode inventar URL: URLs produzidas pelo modelo são rejeitadas. Recommendation de conteúdo usa IDs canônicos e precisa corresponder ao conteúdo MANAGED efetivamente resolvido pelo CN. Pares exercise/equipment precisam estar na lista de compatibilidade EQ do tenant.

## Autoridade proibida

Output contendo comandos/chaves de aprovação, ACTIVE/status, pagamento/financeiro/fiscal, autorização física, entitlement, rights ou publishing falha governada. O modelo não recebe autoridade para mutar esses domínios.

## Limites

- sem provider registry ou NullProvider (G4);
- sem resolução de secretRef (G4);
- sem endpoints mobile (G5);
- sem workout candidate persistente (G6).
