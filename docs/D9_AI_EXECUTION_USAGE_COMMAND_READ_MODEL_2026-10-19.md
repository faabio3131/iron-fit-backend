# IRON D9 — AI Execution Usage → FM Command (read-only)

**Status:** construção interna candidata; nenhuma homologação externa declarada.

## Fonte de verdade
- IRON `AiExecutionTrace`: execução efetivamente persistida, com `gymId`, capability, providerCode, modelCode, status e createdAt.
- FM Command: único proprietário dos preços, licenças, billing, orçamento e regras comerciais. Este endpoint **não** calcula preço, custo, quota ou token.
- Guard server-to-server existente `FmCommandControlPlaneGuard` protege o endpoint. Nenhuma credencial é distribuída para academia.

## Contrato
`GET /api/v1/control-plane/fmcc/usage/ai?days=30`

- `days` opcional, inteiro positivo de 1 a 90; default 30; entradas inválidas = HTTP 400;
- schema `iron.fmcc.ai-usage.v1`, produto `IRON_FIT_CORE`, `as_of`, `window_start` e `window_days`;
- `usage`: contagens agrupadas por tenant, capability, provider, modelo e status; uma execução marcada `UNAVAILABLE` não é transformada em sucesso;
- `unavailable_metrics`: tokens de entrada, tokens de saída e custo do provider não são armazenados no modelo canônico de trace atual — permanecem explicitamente **indisponíveis**, jamais zero estimado;
- origem e agregação explicitadas em `provenance`;
- sem dados pessoais dos alunos, prompts, inputHash, outputHash, requestId, credenciais, valores financeiros ou autoridade de billing.

## Limites
- O consumo real de tokens/custo só poderá ser contabilizado quando a execução de providers tiver evidência canônica e medição transacional. Não confundir contagem de tentativas/executions com tokens consumidos.
- Esta entrega não habilita provider externo, não publica preços/limites no Command e não requer alteração no Command nesta etapa, conforme adiamento decidido pelo proprietário.
- Não criar chamadas do runtime IRON através do Command. Command consulta o read-model; runtime não depende de disponibilidade do Command.
- A produção ainda exige homologação da ponte física/segredos ao final da construção.

## Critérios internos
- Endpoint sob guard server-to-server e com janela limitada;
- query PostgreSQL agregada sem materialização de detalhes privados;
- schema versionado e estados de execução preservados;
- regressões para agrupamento, parâmetros inválidos e ausência de PII;
- backend CI verde, PR/diff auditados, merge apenas com gate verde.

**Sequência futura (construção interna):** reconciliar provider metering real e sua persistência canônica sob políticas FM antes de expor tokens/custo ou quotas comerciais. Nunca estimar valores ausentes.
