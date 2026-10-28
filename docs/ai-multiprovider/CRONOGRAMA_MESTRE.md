# IRON FIT CORE — CRONOGRAMA MESTRE COMPLEMENTAR
## Fechamento técnico do IRON Intelligence Multi-Provider — 27/10/2026

**Estado inicial: GAP CONFIRMADO NO CÓDIGO.** **Natureza:** complemento obrigatório da construção interna, não novo produto, nem alteração visual. **Escopo:** `faabio3131/iron-fit-backend`; app/Web somente se houver gap funcional comprovado. **Não substitui** o Cronograma Mestre O→T. Deve ser concluído e integrado aos gates P/Q/R sem ultrapassar o gate visual do Macro O.

### 1. Autoridade e CURRENT verificado

Hierarquia: CURRENT reprodutível > Prompt/Cronograma Mestre vigente > arquitetura oficial FM Tecnologia > decisões aprovadas. Base observada no GitHub: backend `main` `664ecc6bb90e506a330705bc52a9697cbdec9fb9` (26/10/2026); app PR #56 `36f2756301fa363696d22489c50e0321ad701106` (27/10/2026), CI #40527286661 SUCCESS, 342/342 testes sem skips. Estes SHAs são **checkpoint**, não pins de implementação: reconfirmar HEAD antes de cada mudança.

**Confirmado no backend:** `AiProviderAdapter`, `AiProviderRegistryService`, `AiProviderExecutionService`, `AiConfigurationResolverService`, `AiSecretReferenceService`, `AiPolicyGuardService`, `AiOutputValidatorService`, serviços de advisory e de candidato de treino; quatro capabilities `WORKOUT_INSIGHTS`, `ADVISORY_CHAT`, `WORKOUT_GENERATION`, `CONTENT_RECOMMENDATION`; escopos GLOBAL/TENANT. O registro de providers observado cadastra apenas `null_provider`, que responde `UNAVAILABLE`.

**Não comprovado:** credencial/configuração ativa no runtime, integração live com modelo externo, provider homologado, capacidade de fallback real entre modelos. Não presumir ausência de segredos pela falta de acesso ao Vault. O Render expôs `gym-saas-backend` mas não forneceu leitura de variáveis existentes; banco operacional não foi consultado.

### 2. Resultado exigido

A arquitetura Multi-Provider oficial deve permitir escolher/adicionar fornecedor **suportado** e modelo configurando catálogo/perfil/credencial, **sem código ou deploy por tenant**. Adicionar um *novo protocolo de provider*, ainda não implementado, poderá requerer um novo adapter versionado e testado; não prometer suporte universal sem adapter. Não criar backend paralelo. IA permanece advisory; treino gerado vira **candidato pendente de revisão humana**, não treino ativado automaticamente.

### 3. Work packages (ordem de dependência)

| WP | Entrega verificável | Gate de conclusão |
|---|---|---|
| AI-MP-00 — Reconciliação | Ler AGENTS, docs, commits, banco/schema, registry, runtime, integrações/Vault, configurações, testes e CI; inventariar o que já existe | Matriz CURRENT→GAP e branch isolada; nenhuma reconstrução |
| AI-MP-01 — Contract & Security | Confirmar/preservar contrato normalizado, validação de endpoint/modelo/escopo, allowlist/SSRF, limites, erros, timeout, cancelamento e redaction | Testes adversariais verdes; sem segredos em logs/DB/UI |
| AI-MP-02 — Adapters reais | Implementar e registrar pelo menos **duas famílias de transporte** úteis (p.ex. OpenAI-compatible e Gemini-native, **sujeitas à verificação de API atual**) sem hardcode de modelo ou chave. Substituir nunca o `null_provider` como fallback fail-closed | Testes de request/response/erro, protocolos, registry e DI; provider inválido não executa |
| AI-MP-03 — Configuração governada | Reusar `AiConfigurationProfile`, catálogo de providers e Integration & Secret Vault. Permitir seleção GLOBAL/TENANT e versão de modelo por configuração, com RBAC/step-up e separation of duties | Configurar tenant A sem mudar tenant B, código ou deploy; secretReference opaca |
| AI-MP-04 — Orquestração e fallback | Reconciliar failover por capabilities, custo/limites, timeout/retry/backoff, circuit breaker e política `FAIL_CLOSED`/`ADVISORY_FALLBACK`; definir precedência do profile sem burlar perfil desabilitado | Testes de timeout, quota, 401/403/429/5xx, indisponibilidade, custo e regressão |
| AI-MP-05 — Domínios reais | Conectar `WORKOUT_INSIGHTS`, `ADVISORY_CHAT`, `WORKOUT_GENERATION` e `CONTENT_RECOMMENDATION` ao transporte real; validar schemas; preservar human-in-loop | E2E interno backend/API/DB, permissões/entitlements, `PENDING_REVIEW` |
| AI-MP-06 — Segurança e observabilidade | Proveniência (provider/model/prompt/version/request), latência/consumo/custos sem payload sensível, retries idempotentes, auditoria de alterações, tenant isolation, LGPD e prompt injection | Testes cross-tenant, redaction, concorrência, rastreabilidade, recuperação |
| AI-MP-07 — Certificação interna | Executar Jest/compilação/lint/testes backend existentes, novas regressões e matriz integrada app/API; corrigir e retestar; auditar diff/PR/CI | CI verde no SHA exato; 0 failures; skips classificados; checkpoint persistido |
| AI-MP-08 — Provider externo controlado | Com credencial e ambiente de homologação autorizados, executar chamadas reais, verificar custos e correlação com auditoria; não usar dados reais de alunos sem base legal | `SANDBOX HOMOLOGATED` somente com evidência; caso contrário `IMPLEMENTED/EXTERNAL BLOCKER` |
| AI-MP-09 — Fechamento | PR backend isolada, revisão do diff, CI e merge se gates aplicáveis permitirem; pós-merge CI; integrar no tracker e reavaliar gates P/Q/R | Matriz de capabilities real e checkpoint com SHA/PR/CI/merge/deploy e blockers |

### 4. Gates e autonomia

**Execução permitida:** auditar → implementar → testar → corrigir → retestar → auditar diff → PR → CI → merge quando gates satisfeitos → pós-merge → próximo WP. Correções técnicas e testes internos não exigem autorização individual. **Não executar credenciais de terceiros, cobrar APIs, implantar em produção ou modificar infraestrutura produtiva sem autorização apropriada.** Não alterar a PR visual/branch do outro agente. **Macro O:** merge visual final somente após aprovação explícita do usuário; backend isolado não deve ser usado para burlar esse gate. Se um PR backend independente for elegível ao merge, registrar compatibilidade com branch visual e regras AGENTS existentes.

### 5. STOP-SHIP

Exposição de secrets, vazamento entre tenants, role escalation, uso de provider/modelo não autorizado, prompt injection que ultrapassa fronteira de autoridade, ativação de treino sem revisão quando exigida, cobrança/contabilização incorreta, CI vermelha, E2E crítico vermelho, migrations inválidas ou alegação de homologação externa sem chamada comprovada.

### 6. Checkpoint obrigatório por WP

`data UTC | macro/WP | backend repo/branch/HEAD | app HEAD de referência | alterações | testes e números | CI run/conclusion | PR | merge | deploy/ambiente | provider status | gate | blocker | próximo WP`. Registrar no repositório, não apenas na conversa.

### 7. Distinção dos estados

- `IMPLEMENTED`: código integrado e teste interno aprovado, **sem** chamada externa comprovada.
- `SANDBOX HOMOLOGATED`: execução real observada em sandbox autorizado.
- `PRODUCTION HOMOLOGATED`: credenciais, ambiente, operação e auditoria de produção validados.
- `IMPLEMENTED/EXTERNAL BLOCKER`: pronto internamente, pendente acesso/credencial/aprovação/provider.
- `DISABLED/OUT OF LAUNCH`: desligado por Launch Matrix, não anunciar como ativo.

**DoD global:** capabilities requeridas funcionam em ambiente interno com adapter real, configuração segura e sem mudanças por tenant, regressões/CI verdes, limites de IA e autoridade humana preservados. Homologação externa e go-live só quando houver suas evidências específicas.
