# IRON Multi-Provider runtime

## Escopo e compatibilidade

Evolução do motor canônico, baseada na PR #178. Mantém endpoints de advisory e geração de candidatos, Vault, autenticação, RBAC, entitlements e validação de domínio. App/PR visual não são modificados. Não requer deployment por academia após instalar esta versão; novo protocolo continua exigindo adapter versionado.

Transportes: `openai_compatible` (OpenAI e endpoint NVIDIA autorizado) e `gemini_native` (Gemini GenerateContent). Os nomes de modelos são configurados pela FM, sem defaults de modelo nem chaves em código. O catálogo de integrações permanece a autoridade de credenciais e capacidades.

Referências de protocolo consultadas em 28/10/2026:
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://ai.google.dev/api/generate-content
- https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3_5-bolt-e4b-infer

Compatibilidade de um modelo concreto com JSON e limites deve ser confirmada na homologação. Não implica suporte universal a todo modelo hospedado pelo fornecedor.

## Configuração e autoridade

`POST /admin/ai/configuration-profiles`: JWT + SUPER_ADMIN + senha/MFA/recovery pelo serviço de step-up existente. Um perfil TENANT escolhe a política de uma academia, mas os providers FM resolvem exclusivamente conexões GLOBAL da FM, no ambiente canônico. A academia não fornece chave. O perfil mais recente desabilitado bloqueia; não reverte silenciosamente para GLOBAL ou versão antiga. Profiles são versionados e auditados; concorrência preservada pelo serviço Prisma canônico.

Campos adicionais:
- `maxOutputTokens`: 1–8192, padrão 1024.
- `fallbackTargets`: até dois destinos explícitos `{providerCode, modelCode, endpoint?, secretReference}`. Não aceita escopo/tenant/budget nem autoridade extra no objeto.
- `pricing`: opcional, `inputNanoUsdPerToken` e `outputNanoUsdPerToken`, inteiros não negativos informados pela FM. Não consulta preços externos nem inventa uma tarifa.

Endpoint deve coincidir com protocolo, host e caminho exatos; Gemini deve coincidir com o modelo configurado. NVIDIA exige que `publicConfiguration.apiFamily` da conexão seja `nvidia`, evitando envio de chave OpenAI ao outro fornecedor. A allowlist é de plataforma; não é parâmetro controlado por aluno/tenant. Novos hosts/protocolos passam por revisão de código.

## Limites, custos, retry e idempotência

`budgetUnits` é **número máximo de tentativas externas por versão de perfil**, não moeda nem quantidade de tokens. Deve ser explícito para ativação. GLOBAL compartilha seu limite entre academias que o usam; para orçamento individual, criar perfil TENANT pela FM. `consumedUnits` é reservado atomicamente antes de cada tentativa sob transação SERIALIZABLE. Falhas também consomem a reserva conservadora porque podem ter sido cobradas pelo fornecedor. Não há refund automático nem interpretação de timeout como chamada gratuita.

Cada tentativa tem chave única tenant/request/ordinal; replay/concorrência não dispara nova chamada. Sem persistência de resposta sensível, uma repetição recebe indisponibilidade segura em vez de reutilizar resultado. Crash deixa tentativa PENDING com reserva mantida: investigar antes de repor orçamento por nova versão. Não reexecutar automaticamente tentativas incertas.

Retry: uma repetição com atraso+jitter somente após 429 explícito. Timeout/5xx/offline não são repetidos no mesmo destino; fallback explicitamente configurado pode consumir outra unidade, sob `ADVISORY_FALLBACK`. 401/403, resposta inválida ou política negada encerram sem fallback. `FAIL_CLOSED` nunca troca de destino. Circuito de disponibilidade local por tenant/perfil/provider/model bloqueia por 30s após três falhas transitórias; é otimização por processo. Orçamento/replay continuam duráveis entre réplicas.

Telemetria registra provider/model/prompt/version, hash da entrada, request, status de **tentativa de transporte**, latência e tokens reportados. Não guarda prompts, respostas, credenciais ou payload de erro. Tarifa + tokens medidos produzem estimativa em nanoUSD; falta de tarifa/uso = NULL, nunca zero. Fallback não herda tarifa de outro modelo. Estimativa não substitui invoice nem billing canônico. Status de transporte SUCCEEDED não certifica output aprovado no domínio; a validação canônica e revisão humana continuam obrigatórias.

## Segurança de rede e saída

HTTPS com validação TLS padrão, resolução DNS validada na conexão, proibição de IP privado/link-local/metadata/IPv4 mapeado, sem redirects e sem reutilização de sockets que pule a validação DNS. Probes de credenciais usam o mesmo transporte. Entrada limitada a 64 KB, resposta a 128 KB durante streaming; cancelamento real via AbortSignal e tempo limitado. Saída deve ser objeto JSON, sem protótipo, limite de profundidade e sem eco da credencial. Modelos não recebem ferramentas nem autoridade de execução. IDs/conteúdo passam pela validação canônica; treino continua candidato PENDING_REVIEW.

## Migração e validação

Migration aditiva `20261028030000_ai_multiprovider_attempt_budget`: colunas de orçamento/configuração no profile existente e tabela de tentativas sem material sensível. Aplicação somente em CI/banco descartável ou janela governada; nenhum banco produtivo foi alterado por este trabalho. Antes do cutover, migrar, verificar schema e desativar profiles sem orçamento; rollback de código deve manter a migration e os registros, sem DROP destrutivo.

CI executa `scripts/ai-mp-db-certify.mjs` com flag explícita e NODE_ENV=test em PostgreSQL descartável. Cobertura: replays e orçamento concorrentes, isolamento, versão mais recente desabilitada, rastreabilidade e ausência de payload. Testes determinísticos de protocolos/domínios usam transporte controlado; testes HTTP usam servidor loopback. Nenhum desses testes é homologação de provider externo.

## Gate externo

Credenciais e chamadas reais não foram usadas. AI-MP-08 só recebe SANDBOX HOMOLOGATED após autorização, ambiente/credenciais apropriados e evidência de modelo, quatro capacidades, limites, custos e auditoria. Até então não anunciar IA externa live nem GO-LIVE.
