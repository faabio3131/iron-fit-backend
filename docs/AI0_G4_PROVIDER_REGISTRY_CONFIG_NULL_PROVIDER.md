# IRON-AI0 G4 — Provider Registry, Config Resolver, Secret References & Null Provider

## Escopo

G4 materializa a fronteira operacional provider-neutral do AI0 sem ativar qualquer fornecedor comercial, SDK externo, credencial real ou endpoint mobile. A `main` de G3 continua sendo a autoridade para Context Safety, Policy e validação de output.

## Provider Registry

`AiProviderRegistryService` registra adapters pelo `providerCode` definido no contrato AI0. Registro duplicado falha fechado. O registry não conhece OpenAI, Anthropic, Gemini ou qualquer fornecedor específico; adapters reais permanecem plugáveis por composição futura.

Provider desconhecido resolve para `NullAiProviderAdapter`, que não realiza I/O e retorna `UNAVAILABLE` com categoria governada. Isso permite certificar toda a arquitetura sem uma única credencial real.

## Config Resolver GLOBAL → TENANT

`AiConfigurationResolverService` lê exclusivamente `AiConfigurationProfile` criado no G2. O profile TENANT mais recente possui precedência sobre GLOBAL. Se existe override TENANT e ele está disabled/unavailable, a resolução falha fechado e não contorna a decisão do tenant buscando GLOBAL. GLOBAL só é consultado quando não existe profile TENANT para a capability.

Nenhum profile encontrado, profile desabilitado ou status não ACTIVE retorna `CONFIGURATION_UNAVAILABLE`. A configuração resolvida passa novamente por `defineAiExternalConfiguration` antes do uso.

## Secret References

`AiSecretReferenceService` aceita somente `secretReference` validada pelo contrato. G4 não lê variável de ambiente, não persiste valor secreto, não consulta vault real e não devolve credencial. Enquanto um backend de segredos governado não estiver configurado, a resolução informa `SECRET_BACKEND_NOT_CONFIGURED`.

## Runtime e taxonomia de falhas

`AiProviderExecutionService` é a fronteira única para resolução operacional. Budget explícito igual a zero falha antes do adapter. Timeout é aplicado pelo `timeoutMs` do profile e normalizado para `TIMEOUT`; exceções do adapter tornam-se `PROVIDER_INTERNAL_ERROR`. Provider ausente passa pelo Null Provider e retorna `UNAVAILABLE`.

## Limites preservados

- sem provider comercial real ou SDK vendor-specific;
- sem segredo em claro e sem credencial real;
- sem nova migration: G2 já contém o modelo persistente necessário;
- sem endpoints `/me/ai/*` (G5);
- sem workout candidate persistente (G6);
- sem alterar a soberania de Product Entitlements, Equipment ou Creator Network.
