# IRON FIT CORE — EGM drift (escopo verificado) e checkpoint operacional

Data local de referência: 2026-11-10, Brasil. Esta é uma inspeção seletiva, **não** uma certificação de todas as sete skills. Fonte de verdade: código GitHub e CI. Não há Goldfish/subagente independente registrado.

## docs/AI_MONTHLY_QUOTAS_COMMERCIAL_ROLLOUT.md

- **DRIFT DOCUMENTAL IDENTIFICADO E CORRIGIDO NESTA BRANCH:** o texto anteriormente dizia que a liberação da cota de IA para candidatos de treino rejeitados após execução do provider ainda estava aberta.
- **CURRENT comprovado no código:** `src/modules/ai/runtime/ai-monthly-quota.service.ts::releaseRejectedWorkout(tenantId, requestId, periodStart)` atualiza `AiMonthlyConsumption` apenas com `tenantId`, grupo `WORKOUT`, `requestId`, `periodStart` e estado `CONSUMED`.
- **Propagação:** `src/modules/ai/ai-workout-candidate.service.ts` passa `response.quotaPeriodStart` à operação de liberação nas duas rejeições canônicas.
- **Teste de regressão presente:** `test/ai-workout-quota-rejected.test.mjs` inclui reutilização do mesmo ID em meses distintos, isolamento entre academias e grupos, período inválido e as duas rejeições. Isto evidencia cobertura em código; conferir o resultado de CI na revisão exata para declarar PASS.
- **Reparo:** atualizado o parágrafo no documento de rollout. O estado geral de rollout de novos planos/pacotes permanece `CANDIDATE — NOT PRODUCTION ACTIVE`; a correção técnica não equivale a homologação de provider ou de pagamentos.

## docs/M5_TRIAL_PROVISIONING_ONBOARDING.md

No drift detected no subconjunto de contratos examinado: `CommercialTrialService`, `CommercialTrialProvisioning`, `CommercialOnboardingCheckpoint` e o controller preservam o fluxo público `/commercial/trial/start` → autenticação → onboarding e a política do trial na `CommercialLaunchMatrix` APPROVED. O status do documento é **CERTIFIED INTERNAL**; não estende a certificação à operação pública atual.

## docs/operations/M_OPERATIONS_SRE_SUPPORT.md

- **EVIDÊNCIA OPERACIONAL PENDENTE, não corrigível apenas por documentação:** suporte/on-call, destino de alertas e entrega de alerta real, rollback drill e prova do ambiente PROD. O runbook já exige esses critérios; nenhum PASS externo foi inventado.
- Snapshot anterior acessível no domínio público apontava `runtimeEnvironment=HOMOLOG` e backend `76774df987cf2dadf37ebdf142c6e057f04414b9`. O nome da imagem Web ativa ainda deve ser conferido via deploy canônico; merge no GitHub não é deploy.
- O script `scripts/public-edge-preflight.mjs` já exige HTTPS, DNS, CORS, liveness, readiness, SHA e ambiente explícitos. Falta um recibo executado no destino público para declarar o gate operacional.

## EGM original — matriz de execução honesta

| Skill | Situação nesta rodada | Recibo |
| --- | --- | --- |
| egm-brainstorm | NOT_RUN — requer concepção/hipótese e revisão com Goldfish nativo | Nenhum |
| egm-draft | NOT_RUN — exige conceitos alinhados e validação de seções pelo autor | Nenhum |
| egm-bootstrap | NOT_RUN — exige escopo da árvore/documentação e separação de VCS | Nenhum |
| egm-review | UNAVAILABLE_NATIVE — esta sessão não oferece subagentes Goldfish isolados | Nenhum |
| egm-resolve | NOT_APPLICABLE — faltam findings de Goldfish reais | Nenhum |
| egm-review-loop | UNAVAILABLE_NATIVE — esta sessão não oferece Goldfish frescos | Nenhum |
| egm-drift-report | PARTIAL_EXECUTED — comparação seletiva de três documentos com código CURRENT; uma divergência documental corrigida | Este arquivo + diff do rollout |

Não classificar auditoria realizada pelo executor principal como revisão independente. O plugin FM Engineering Supervisor é mecanismo de supervisão de evidências, não um gerador de aprovação de Goldfish.

## Sequência operacional e gates restantes

1. **IRON Web:** PR #97 integrada em `main` (`7565661bf915ee72a3a3866838ea4f9c6dd68839`); PR #98 integrada em `production` (`e694c340279abf9d732b39cddfea0949ba00fcfc`). CI pós-merge `42945152916`: SUCCESS, 22 etapas; deployment na Contabo **NOT_VERIFIED**. Use `ops/contabo/deploy.sh --check` / `deploy.sh` por operador com acesso SSH; depois confira `status` e os health checks. Não alterar outros SaaS.
2. **FM Command:** PR #219 em `FM-CONTROL-CENTER`, HEAD `081dbc24e5acfdea0a1f6aa6f578ffc96b1efb23`. CI Foundation `42943075027` e F21 `42943074618` SUCCESS; revisão independente ainda não registrada. **REVIEW_REQUIRED**, não mesclar como gate verde completo.
3. **Teste grátis oficial:** usar o CTA público, cadastrar uma academia real mediante consentimento, login OWNER, configuração inicial, matrícula/treino/check-ins e observar o registro individual no Command. **NOT_EXECUTED** nesta rodada; não criar usuários/empresas artificiais.
4. **Cakto:** configuração, ofertas e cobrança real fora do escopo desta janela; nenhum valor de pagamento é inferido de trial.
5. **EGM nativo:** solicitar execução das fases que exigem Goldfish em harness com ferramenta nativa de subagentes (Codex/Work) e persistir relatórios dos agentes; não declarar PASS por leitura das skills.

## Fontes técnicas examinadas

- Repos: `faabio3131/iron-fit-backend`, `faabio3131/iron-fit-app`, `faabio3131/FM-CONTROL-CENTER`.
- Código/contratos: `src/modules/commercial/commercial-trial.service.ts`, `src/modules/ai/runtime/ai-monthly-quota.service.ts`, `src/modules/ai/ai-workout-candidate.service.ts`, `test/ai-workout-quota-rejected.test.mjs`.
- Este checkpoint não é autorização para deploy, merge sem review, plano pago, Cakto, nem prova de operação PROD.
