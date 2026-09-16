# IRON-AI0 G1 — Architecture, Contracts & External Configuration

## Status

Gate 1 define a fundação arquitetural da IRON Intelligence sem provider externo real, credencial de produção, endpoint `/me/ai/*` ou persistência específica de IA.

## Objetivos

A camada AI permanece provider-neutral e isolada em `src/modules/ai/`. O domínio não importa SDK de fornecedor. Toda execução futura deve passar por contratos normalizados, política governada, configuração resolvida server-side, validação de saída e proveniência.

## Zero-code client onboarding

Novo CLIENTE = configuração. Novo PROVIDER ou nova CAPABILITY = adapter/contrato + engenharia governada.

Configurações suportadas devem ser representáveis sem `if (tenant === ...)`, fork, recompilação ou redeploy específico por cliente.

A precedência arquitetural é:

1. IRON GLOBAL POLICY;
2. GLOBAL PROVIDER PROFILE;
3. TENANT CONFIGURATION;
4. CAPABILITY CONFIGURATION.

Uma camada inferior nunca amplia a autoridade da superior.

## External Configuration Contract

O contrato canônico suporta `scope`, `tenantId`, `capability`, `providerCode`, `modelCode`, `endpoint`, `region`, `timeoutMs`, `budgetUnits`, `enabled`, `fallbackBehavior`, `secretReference`, `status` e `version`.

`secretReference` é apenas uma referência opaca para resolução server-side. O contrato não autoriza armazenamento de API key, token ou segredo inline.

Configuração GLOBAL não aceita `tenantId`; configuração TENANT exige `tenantId`. Endpoints externos, quando permitidos, usam HTTPS.

## Provider contract

`AiProviderAdapter` recebe request normalizado e configuração governada. O domínio não seleciona fornecedor pelo nome comercial e não contém SDK específico.

A ausência de provider/configuração/credencial real não bloqueia a fundação. O comportamento operacional seguro será materializado no Gate 4 com registry e Null/Unavailable Provider.

## Invariantes

A IA pode sugerir, analisar, resumir, recomendar, auxiliar e futuramente gerar candidatos. Ela não pode autonomamente autorizar acesso físico, movimentar dinheiro, executar fiscal, alterar entitlements, criar direitos/licenças, publicar conteúdo, determinar tenant ou ativar treino.

Treino gerado por IA, quando implementado no Gate 6, será apenas candidato governado e continuará dependente do fluxo humano canônico.

## Fontes canônicas

AI0 consome, não duplica, S0-S12, EQ0-EQ5, PE0-PE4, CN0-CN9 e o Workout domain. `ai.workout_generation` e `ai.content_recommendation` permanecem fail-closed pelo resolvedor de Product Entitlements.

## Limites do Gate 1

- nenhuma migration;
- nenhuma chamada externa;
- nenhuma credencial real;
- nenhum provider comercial escolhido definitivamente;
- nenhum endpoint `/me/ai/*`;
- nenhuma geração de workout candidate;
- nenhuma alteração de regra determinística certificada.
