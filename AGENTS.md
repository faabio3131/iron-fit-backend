# AGENTS.md — IRON FIT CORE — DELTA ONLY

## Missão

Concluir exclusivamente os gaps ainda não resolvidos do IRON FIT CORE até:

**IRON FIT CORE V1.0.0 — GO-LIVE CERTIFIED**

Este arquivo é um contrato operacional para agentes. Não é inventário do produto.

Se uma capacidade já estiver concluída no CURRENT reproduzível, **não reimplementar**. Registrar evidência, preservar e avançar.

## Autoridade

Usar nesta ordem:

1. CURRENT técnico reproduzível: código, schema, migrations, APIs, testes, CI, builds, ambientes e deploys.
2. Prompt/Cronograma Mestre vigente.
3. Arquitetura e documentação funcional vigente.
4. Decisões aprovadas pelo usuário.
5. Identidade visual oficial atual do IRON/FM Tecnologia.

Documento histórico nunca prevalece sobre CURRENT comprovado.

## Regra de execução

Para cada pendência:

**AUDITAR CURRENT → IDENTIFICAR GAP REAL → IMPLEMENTAR SOMENTE O GAP → TESTAR → CORRIGIR → RETESTAR → AUDITAR DIFF → PR → CI → MERGE QUANDO O GATE PERMITIR → PÓS-MERGE → PRÓXIMA PENDÊNCIA**

Falhou:

**causa-raiz → correção → teste de regressão quando aplicável → reteste**

Não pedir autorização para correções técnicas normais dentro do escopo.

Parar somente por:
- gate humano obrigatório;
- credencial externa necessária e indisponível;
- ação irreversível não autorizada;
- conflito arquitetural real;
- risco material fora da autorização;
- blocker externo genuíno.

## Regra de arquitetura

Não duplicar nem substituir:
- autenticação;
- sessão;
- tenant;
- RBAC;
- permissions;
- entitlements;
- regras financeiras;
- APIs canônicas;
- segurança;
- auditoria;
- idempotência;
- Vault;
- Integration Fabric;
- domínio canônico.

Backend continua autoridade das regras de negócio.

Não criar endpoint fictício, persistência falsa ou botão que prometa capacidade inexistente.

---

# DELTAS REAIS A CONCLUIR

## D1 — Alunos 360°

Consolidar a experiência Web do aluno em um workspace único usando APIs e domínios já existentes.

Incluir, conforme RBAC:
- perfil;
- avaliações;
- evolução;
- treinos;
- agenda;
- check-ins;
- acessos;
- consentimentos;
- plano do aluno;
- cobranças;
- pagamentos;
- histórico.

Não criar domínio paralelo.

## D2 — Equipe / RBAC

Finalizar a experiência Web de administração da equipe.

Exibir de forma clara:
- membro;
- função;
- status;
- permissões efetivas;
- áreas permitidas;
- áreas bloqueadas;
- ativação/desativação;
- convite;
- alteração de função.

Certificar:
- SUPER_ADMIN;
- OWNER;
- MANAGER;
- RECEPTION;
- TRAINER;
- STUDENT.

Impedir privilege escalation, tenant spoof, bypass por URL/API e acesso administrativo indevido.

## D3 — Equipment Intelligence

Finalizar a superfície Web como inventário inteligente.

Organizar:
- catálogo;
- inventário da academia;
- busca;
- filtros;
- fabricante/modelo;
- categorias;
- compatibilidade com exercícios;
- candidates;
- governança/review;
- status.

Usar exclusivamente o domínio existente.

## D4 — Biblioteca de Exercícios

Transformar a superfície atual em biblioteca Premium.

Cobrir:
- busca;
- filtros;
- grupo muscular;
- nível;
- equipamento;
- compatibilidade;
- conteúdo;
- vídeo quando aplicável;
- contraindicações.

## D5 — Avaliações

Finalizar a experiência visual de evolução física.

Cobrir:
- histórico;
- peso;
- altura;
- medidas;
- composição;
- comparação temporal;
- evolução;
- observações;
- restrições;
- vínculo com treino.

## D6 — Workout Studio

Finalizar a experiência profissional de criação e revisão de treinos.

Preservar:
**criação manual → DRAFT → candidato IA opcional → PENDING_REVIEW → revisão humana → APPROVED**

A IA permanece advisory e não ganha autoridade crítica.

## D7 — IRON Intelligence Web

Criar ou completar a superfície Web dedicada usando exclusivamente o backend de IA existente.

Incluir, quando permitido por entitlement:
- insights;
- chat;
- recomendações;
- sugestões;
- contexto do aluno;
- candidate generation;
- provenance quando aplicável;
- estados de erro/fallback.

Não criar novo engine de IA.

### Credenciais de IA

Toda API/modelo que alimenta a IA pertence à **FM Tecnologia**.

Exemplos:
- Gemini;
- OpenAI;
- Anthropic;
- providers futuros.

A academia nunca fornece API key de IA.

Credenciais, modelo, endpoint, billing, quotas, fallback e roteamento são administrados centralmente pela FM via Command/Vault/Secret Reference/infraestrutura autorizada.

### API de alimentação e APIs de execução do IRON — autoridade preservada

**O Command é control-plane, não runtime proxy do IRON.** A integração funcional permanece 100% no backend IRON: autenticação → tenant/RBAC/entitlement → execução IRON → provider externo → resposta do IRON. Somente configuração governada, credenciais da FM por Secret Reference, gestão de custo/quotas e coleta de métricas de uso fluem pelo Command. O IRON continua chamando o provider diretamente pelo seu adapter e reportando telemetria por contrato server-to-server com dados mínimos. Não criar endpoint fictício, proxy obrigatório no Command nem trasladar regra de negócio ou PII para lá. A implementação específica deve partir do CURRENT; consultar `docs/D9_D12_IRON_RUNTIME_API_COMMAND_CONTROL_USAGE_BOUNDARY_2026-10-13.md`.


## D8 — Aggregator Hub Web

Criar a superfície Web faltante somente no escopo permitido pelo launch atual.

Representar:
- resumo operacional;
- fila da recepção;
- elegibilidade;
- visitas;
- risco;
- reconciliação;
- settlement;
- analytics;
- tendências.

Nunca apresentar Wellhub ou TotalPass como live sem homologação real.

## D9 — Integração IRON ↔ FM Command

Implementar a ponte governada entre IRON FIT CORE e FM Command.

Proibido acesso direto entre bancos.

Arquitetura:

**IRON canonical APIs ↔ contrato server-to-server versionado ↔ Integration Fabric do FM Command**

Criar contrato canônico versionado do IRON conforme o padrão vigente do Command.

Expor apenas fatos necessários, com:
- productId;
- tenantId;
- source;
- timestamp;
- schemaVersion;
- mappingVersion;
- freshness;
- provenance;
- correlationId quando aplicável.

Fatos candidatos:
- identidade do produto;
- academia/tenant;
- trial;
- onboarding;
- assinatura;
- status operacional;
- usage;
- engagement;
- health;
- fatos comerciais necessários;
- métricas autorizadas.

Nunca transformar ausência em zero.

## D10 — Centralizar Billing FM no Command

Reconciliar o billing do IRON com a arquitetura corporativa da FM.

Separação obrigatória:

**Permanece no IRON:** academia → aluno.

**Autoridade do FM Command:** FM Tecnologia → academia.

Auditar o `saas-billing` existente e classificar cada componente como:
- KEEP;
- ADAPT;
- MIGRATE AUTHORITY TO COMMAND;
- REMOVE somente se comprovadamente obsoleto.

Eliminar duas autoridades concorrentes.

A área "Assinatura IRON" pode continuar no produto, mas deve consumir a autoridade financeira canônica.

## D11 — Command → IRON: licença e entitlement

Implementar o fluxo governado:

**cliente → plano IRON → Command → invoice → gateway FM → pagamento confirmado → entitlement/licença IRON**

Cobrir:
- active;
- grace;
- delinquent;
- suspended;
- cancelled;
- renewal;
- upgrade;
- downgrade.

Exigir:
- server-to-server auth;
- idempotência;
- replay protection;
- tenant/product binding;
- audit;
- provenance.

Webhook externo nunca libera entitlement diretamente.

## D12 — Homologações externas

Executar apenas com ambiente/credencial real.

### Configuráveis por tenant
- Meta;
- WhatsApp;
- Google operacional da academia;
- fiscal/provider pertencente ao cliente;
- Wellhub;
- TotalPass;
- integrações futuras do tenant.

Fluxo obrigatório:

**Integration Center → configuração pública → secretReference → Vault → adapter**

Nunca exigir alteração de código por cliente.

### Contas da FM Tecnologia
- FM Command;
- Asaas;
- Cakto;
- e-mail da plataforma;
- Gemini;
- OpenAI;
- Anthropic;
- outros providers cognitivos;
- serviços corporativos.

O cliente não informa essas credenciais.

Status permitidos:
- PRODUCTION HOMOLOGATED;
- SANDBOX HOMOLOGATED;
- IMPLEMENTED / EXTERNAL BLOCKER;
- DISABLED / OUT OF LAUNCH.

## D13 — E-mail transacional da FM

Se ainda não houver homologação final comprovada, certificar:
- signup;
- verificação;
- recuperação;
- alteração de e-mail;
- notificações críticas;
- domínio;
- SPF;
- DKIM;
- DMARC;
- bounce;
- retry;
- redaction.

## D14 — Fiscal externo

Homologar somente quando houver provider, município, credenciais/certificados e ambiente autorizado.

Testar:
- emissão;
- consulta;
- cancelamento;
- reconciliação;
- falhas.

Nunca declarar homologação sem evidência.

## D15 — Visual Premium final

Após fechar os gaps funcionais, finalizar o Visual Premium no produto real.

Eliminar:
- raw JSON;
- aparência técnica;
- códigos internos desnecessários;
- formulários crus;
- template genérico repetido;
- inconsistência de espaçamento;
- ações sem feedback;
- verde/lime legado;
- roxo legado dominante.

Manter identidade azul oficial do IRON.

Cada módulo deve refletir sua função.

## D16 — Auditoria de clicáveis

Auditar toda a Web final:
- buttons;
- cards;
- links;
- tabs;
- chips;
- menus;
- ações;
- formulários;
- modais.

Zero elemento visualmente clicável sem handler real.
Zero capacidade existente inacessível por erro de UI.

## D17 — Responsividade e acessibilidade

Certificar:
- desktop;
- notebook;
- tablet;
- Web mobile;
- Android;
- iOS.

Validar:
- overflow;
- clipping;
- focus;
- keyboard;
- labels;
- touch targets;
- contraste;
- modais;
- loading;
- error;
- empty state.

## D18 — Fechar Macro O

Executar:
- testes;
- lint;
- typecheck;
- build;
- Android export;
- iOS export;
- Web export;
- container;
- HTTP smoke;
- regressão.

Publicar preview real.

### Gate humano obrigatório

O merge final do Macro O é proibido até aprovação visual explícita do usuário.

Se houver correções:
**corrigir → testar → CI → redeploy → nova revisão**

Após aprovação:
**merge → pós-merge → Macro P**

## D19 — P → Q → R → S → T

Depois do Macro O:

### P — Commercial E2E
Executar jornada real:
**visitante → trial → provisioning → login → onboarding → academia → equipe → aluno → avaliação → treino → agenda/acesso → financeiro academia → plano IRON → FM Command → billing → pagamento → entitlement → Web/mobile**

Testar retry, replay, concorrência, idempotência, expiração, falha de pagamento, dunning, cancelamento, remoção de entitlement e tenant isolation.

### Q — Security & Performance
Testar:
- cross-tenant;
- IDOR;
- privilege escalation;
- spoofing;
- MFA;
- step-up;
- session/refresh/reset replay;
- brute force;
- forged webhook;
- payment mismatch;
- entitlement bypass;
- secret leakage;
- IA tenant leakage;
- prompt injection boundary;
- provider errors;
- Vault isolation.

STOP-SHIP para crítico/alto, cross-tenant leak, secret leak, privilege escalation, PAN/CVV.

Medir p50, p95, p99, throughput, error rate, CPU, memória e DB/connections.

### R — Commercial Readiness
Auditar produto final:
- Web;
- mobile;
- backend;
- Command;
- billing;
- gateway;
- e-mail;
- fiscal;
- providers;
- AI provider central;
- DB;
- migrations;
- backup/restore;
- Vault;
- LGPD/legal;
- observability;
- alerts;
- runbooks;
- DNS/TLS;
- rollback.

GO somente por evidência.

### S — V1.0.0
Congelar SHAs, schema, migrations, URLs, Launch Matrix, providers, Command connector, configuração de IA, known debts, changelog, release notes e rollback.

Criar release/tag:

**IRON FIT CORE V1.0.0**

### T — Go-live
Executar preflight, cutover, smoke real, monitoramento e validação pós-go-live.

---

## Integrações configuráveis — regra permanente

Integração pertencente ao cliente deve ser configurável por tenant.

Nunca exigir:
- editar código;
- alterar `.env` por academia;
- criar branch;
- novo deploy por cliente.

Credenciais de tenant ficam no Vault por referência, com masking, step-up, MFA quando aplicável, rotate, replace, verify, revoke, audit e environment isolation.

## Segurança

Nunca expor secrets.

Respeitar:
- Vault/Secret References;
- tenant isolation;
- RBAC;
- entitlements;
- step-up;
- MFA;
- least privilege;
- audit;
- idempotência.

Cross-tenant leak, secret leak, privilege escalation, PAN/CVV persistido/logado ou vulnerabilidade crítica/alta = **STOP-SHIP**.

## Checkpoint obrigatório

Manter:
- Macro;
- WP/delta;
- repositório;
- branch;
- HEAD;
- PR;
- CI;
- testes;
- deploy;
- ambiente;
- migrations;
- Command integration;
- providers;
- AI provider central;
- merge;
- blocker;
- próximo passo.

## Fechamento

Este arquivo contém somente pendências.

Antes de iniciar qualquer delta:
1. verificar CURRENT;
2. comprovar que o gap ainda existe;
3. se já estiver concluído, não alterar;
4. registrar evidência e avançar.

Quando todos os deltas estiverem concluídos, executar uma **auditoria final profunda pós-execução** comparando:

**arquitetura × backend × APIs × Web × mobile × Command × RBAC × entitlements × billing × integrações × segurança × CI × deploy × produto real**

Objetivo final:

**IRON FIT CORE V1.0.0 — GO-LIVE CERTIFIED**


## Ordem vigente pós-auditoria — construção primeiro, Web depois (24/10/2026)

A auditoria funcional de 24/10/2026 é o inventário de referência, sujeito ao CURRENT do código. Trabalhar autonomamente nos dois repositórios: `faabio3131/iron-fit-backend` e `faabio3131/iron-fit-app`.

**Sequência obrigatória:** (1) reconciliar e concluir funcionalidades do backend, domínio, segurança, migrations e contratos, sem duplicar código; (2) executar testes de unidade, integração, autorização e regressões até 100% verde; (3) somente após concluir internamente cada capacidade, integrar o que ainda falta à Web real e ao Mobile apropriado, sem reconstruir o que já está exposto; (4) certificar fluxos reais de UI, RBAC, português, responsividade e builds; (5) seguir pacotes internos restantes; (6) homologar provedores externos posteriormente.

**Ordem de pacotes:** C01 RBAC/tenant/permissions/step-up e integridade; C02 alunos/equipe/equipamentos/exercícios/avaliações/treinos/agenda/acessos/comunicação; C03 Intelligence e Creator Network; C04 FM Command, licenças e entitlements, preservando financeiro academia→aluno separado do billing FM→academia; C05 integrações e contratos de e-mail/Meta/Google/fiscal/agregadores; W01 integração Web/Mobile das capacidades C01–C05 concluídas; W02 QA de todos os clicáveis, seis perfis, visual premium, acessibilidade; I01 E2E comercial e segurança internos; E01 homologações reais posteriormente.

**Autonomia:** AUDITAR → IMPLEMENTAR GAP → TESTAR → CORRIGIR FALHA → RETESTAR → DIFF → PR → CI 100% VERDE → MERGE SE AUTORIZADO → PÓS-MERGE → PRÓXIMO WP. Falhas corrigíveis nunca viram PASS; corrigir e retestar. Sem novas autorizações para correções normais. Registrar SHA, testes, CI, PR, gate e próximo WP no checkpoint existente, evitando documentação redundante.

**Gates:** PR #22/Macro O só recebe merge após aprovação visual explícita do proprietário. Nenhum endpoint, provider ou recurso sem prova deve ser anunciado live. Homologação externa ausente não bloqueia construção interna independente e deve ficar em `IMPLEMENTED/EXTERNAL BLOCKER` ou `DISABLED/OUT OF LAUNCH`. Após software internamente concluído, executar homologações externas exigidas para GO-LIVE.

**Migração:** Claude Code é responsável pela mudança de hospedagem para Contabo. Este executor não altera Render, Railway, Supabase, DNS, containers, banco ou deploy físico durante essa migração.

---

# ALERTAS-1 — Centro de Alertas do Gestor e entrega multicanal (29/10/2026)

## Decisão aprovada

Construir integralmente o Centro de Alertas do Gestor. O alerta é um domínio canônico do IRON e não pertence à Evolution, ao e-mail ou ao push. Cada canal é somente um adapter de entrega governado.

**Fluxo obrigatório:**

`evento canônico → regra/política → alerta persistido → destinatários autorizados → painel interno → adapters opcionais → status/evidência`

Não reutilizar `CommunicationMessage` como banco genérico de alertas: comunicação academia→aluno e alertas operacionais a gestores possuem destinatários, consentimentos, autoridade e retenção diferentes.

## Escopo funcional aprovado

Alertas iniciais:

1. cobrança de aluno vencida/inadimplência;
2. queda de frequência e risco de cancelamento;
3. avaliação ou treino pendente;
4. equipamento com problema;
5. falha de pagamento, e-mail ou WhatsApp;
6. integração desconectada/degradada;
7. limite do plano próximo;
8. tentativa de acesso suspeita;
9. incidente operacional;
10. pendência de aprovação humana de treino/candidato IA.

Destinatários iniciais: `OWNER` e `MANAGER`, respeitando tenant, membership ativa, RBAC, preferência individual e sensibilidade. Financeiro e segurança nunca podem ser ampliados a papéis sem autoridade. `SUPER_ADMIN` atua somente no escopo administrativo legítimo da plataforma.

## Canais

- **Painel interno:** obrigatório na V1 e fonte de verdade de leitura.
- **Push:** adapter opcional; não inventar token/dispositivo inexistente.
- **E-mail:** adapter opcional, dependente do provider transacional homologado.
- **WhatsApp/Evolution:** adapter opcional para alertas importantes; usa a Evolution central da FM, instância isolada por academia e nunca expõe API key ao cliente.
- **Meta WhatsApp:** alternativa futura/por tenant; exatamente um provider WhatsApp ativo por academia.

Ausência ou falha de canal externo não pode apagar o alerta interno.

## Arquitetura e segurança obrigatórias

- tenant isolation em todas as chaves, consultas, índices e eventos;
- destinatário por membership/role canônica, nunca por `role` recebido livremente do browser;
- idempotência/deduplicação por evento, regra, tenant e janela;
- severidade `INFO | WARNING | CRITICAL`;
- ciclo `OPEN | ACKNOWLEDGED | RESOLVED | DISMISSED` com transições autorizadas;
- confirmação individual de leitura e reconhecimento;
- auditoria de criação, leitura, reconhecimento, resolução, silenciamento e falha de entrega;
- preferências por usuário/categoria/canal, quiet hours e timezone;
- escalação governada de críticos sem loop;
- retry/backoff/lease/DLQ nos canais externos;
- payload mínimo, sem segredo, PAN/CVV, token, senha ou dado de saúde desnecessário;
- step-up para políticas sensíveis e mudanças globais;
- retenção e redaction compatíveis com LGPD;
- alertas de segurança não podem ser silenciados de forma insegura;
- Evolution/Meta/e-mail/push sempre via Vault/Secret Reference e adapters existentes.

## Cronograma executável e retomável

| Etapa | Entrega | Gate de conclusão | Estado inicial |
|---|---|---|---|
| A0 | Reconciliação CURRENT, ADR curto, contratos e threat model | Nenhum domínio duplicado; mapa de eventos e autoridade aprovado pelo código/testes | `DONE` |
| A1 | Schema/migration de alerta, destinatário, preferência, entrega e deduplicação | Fresh migration + rollback lógico + índices tenant-scoped + Prisma validate | `DONE` — fresh PostgreSQL verde na CI `40801458606` |
| A2 | Serviço canônico de ingestão, dedupe, lifecycle e auditoria | Unidade/integração cobrindo concorrência, replay, RBAC e cross-tenant | `DONE` — contratos, replay e fronteiras tenant cobertos |
| A3 | APIs do painel: inbox, contadores, filtros, ler, reconhecer, resolver, dispensar | Contratos paginados; OWNER/MANAGER; fail-closed; testes HTTP/RBAC | `DONE` |
| A4 | Preferências, quiet hours, severidade mínima e políticas governadas | Preferência individual; política tenant com step-up; segurança não silenciável | `DONE` |
| A5 | Produtores dos 10 alertas aprovados | Cada produtor tem evento/dedupe/evidência e teste; sem cron duplicado | `DONE_INTERNAL` — fontes reais e gate PostgreSQL/CI integral da PR #186 aprovados |
| A6 | Outbox e adapters painel/e-mail/push/WhatsApp | Painel sempre disponível; retry/lease/DLQ; provider externo pode ficar blocked | `DONE_INTERNAL` — outbox, recovery, retry, DLQ, consentimento atual e quiet hours; push DISABLED/OUT_OF_LAUNCH |
| A7 | Evolution no IRON: control-plane FM, instância por academia, QR/status/webhook | Engenharia interna + testes; segredo global não entregue ao tenant; homologação real separada | `DONE_INTERNAL/EXTERNAL_HOMOLOG_PENDING` — CI `40801458606` verde |
| A8 | Web Premium e Mobile: sino, badge, inbox, detalhe, ações e preferências | Desktop/tablet/mobile; acessibilidade; zero clicável falso; seis perfis testados | `IMPLEMENTED/APP_CI_GREEN` — app PR #58 CI `40802857324` SUCCESS, isolada do Macro O #56 |
| A9 | Certificação consolidada backend/app | lint, typecheck, testes, migrations, build, exports, container e regressão verdes | `IN_PROGRESS` — backend verde; app em validação |
| A10 | Homologação física dos canais | QR real, envio/recebimento, e-mail, push, restart/reconnect e evidências | `PENDING_EXTERNAL` |

## Ordem de execução

`A0 → A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9`, mantendo `A10` para quando houver credenciais, dispositivos e autorização de teste real.

Subir checkpoints substanciais ao GitHub. Não deixar trabalho relevante somente no ambiente local. Uma PR pode agrupar etapas coesas, mas nenhum merge pode omitir CI verde, migrations seguras ou compatibilidade com o trabalho concorrente do Macro O.

## Critérios de aceite mínimos

- alerta criado uma única vez sob replay/concorrência;
- academia A nunca lê, reconhece ou resolve alerta da academia B;
- MANAGER não recebe conteúdo financeiro/segurança além da autoridade efetiva;
- alerta crítico aparece no painel mesmo com todos os providers externos indisponíveis;
- quiet hours adiam apenas canais externos permitidos;
- resolução e reconhecimento são distintos e auditados;
- falha de Evolution/e-mail/push produz estado de entrega e retry, não falso `SENT`;
- QR/session da Evolution é isolado por academia;
- nenhum segredo aparece em API, log, banco de domínio, UI ou evidência;
- UI apresenta loading/error/empty/offline/retry sem transformar falha em lista vazia;
- compatibilidade com `CommunicationMessage` academia→aluno preservada.

## Checkpoint ALERTAS-1

Atualizar este bloco a cada entrega:

- etapa atual: `A5`;
- backend branch/PR/SHA: `feat/alertas-gestor-v1` / PR #186 (draft) / head remoto validado `7a879f8`;
- app branch/PR/SHA: `feat/manager-alerts-v1` / PR #58 (draft) / head remoto em validação `917d4cf`;
- migrations: `20261029010000_manager_alerts_core` implementada e fresh-install PostgreSQL verde na CI `40800750938`;
- testes backend: `manager-alerts-boundary.test.mjs` 8/8 verde e `manager-alerts.service.test.mjs` incluído; CI `40801458606` passou smoke, integração, browser, segurança e container;
- testes app: suíte específica do centro de alertas adicionada; validação integral da PR #58 em andamento;
- CI: backend `40801458606` 100% verde; app `40802475567` em execução após correções de typecheck/lint;
- deploy: `não autorizado nesta ordem`;
- homologação Evolution/e-mail/push: `PENDING_EXTERNAL`;
- próximo passo: concluir CI da app PR #58, instrumentar os eventos reais de A5 sem cron duplicado e certificar A9; push e homologação física Evolution permanecem blockers externos explícitos.


## Retomada ALERTAS-1 — 29/10/2026

- CURRENT remoto recuperado: backend PR #186 `f899a80` com CI `40802577119` SUCCESS; app PR #58 `aad3f8f` com CI `40802857324` SUCCESS. A falha de tipagem da tela já foi corrigida.
- A5 avanço: reconciliação paginada de cobranças PENDING/EXPIRED vencidas e não pagas, treinos PENDING_REVIEW e aprovação humana de candidatos IA. Tenant derivado dos registros canônicos; IDs estáveis para dedupe; cursor só avança após ingestão; reinício reprocessa com dedupe persistida. Não altera pagamentos nem aprova treinos.
- Scheduler existente compartilhado: `MANAGER_ALERT_SCAN_ENABLED=true` habilita leitura de fontes internas; `MANAGER_ALERT_DISPATCH_ENABLED=true` habilita entrega externa separadamente. Flags desabilitadas por padrão; nenhuma configuração de ambiente/deploy alterada. Falha de scan registra código sanitizado e não impede despacho da outbox.
- Testes locais: Prisma generate, lint/typecheck, build e 14/14 testes focados PASS. Primeira regressão: 802/806 PASS; quatro falhas por configuração local ausente (runtime e chaves efêmeras de teste). Reexecução com ambiente isolado equivalente ao CI concluída: 806/806 PASS, zero falhas. Teste adicional posterior do scheduler: 3/3 PASS (scan independente, erro sanitizado e outbox não bloqueada).
- Código publicado na PR #186, candidate de código/testes `616e375`; CI `40896592711` pendente no momento deste checkpoint. Sem merge/deploy. PR visual #56 preservada.
- A5 continua IN_PROGRESS: produtores restantes (frequência, equipamentos, integrações, limites, segurança, incidentes e falhas externas) ainda exigem conexão aos fatos reais. A10/homologação física Evolution, e-mail e push permanece PENDING_EXTERNAL, conforme decisão do usuário.
- Próximo passo: concluir regressão e CI do candidate; corrigir falhas reais, instrumentar produtores restantes e certificar A9. Não tratar este avanço como conclusão dos dez produtores nem como GO-LIVE.


## Checkpoint vigente ALERTAS-1 — fontes reais (29/10/2026)

- Etapa: A5 implementada; A9 em certificação. Backend PR #186 / branch `feat/alertas-gestor-v1`; candidate de código `d41d778`. Sem merge/deploy.
- Validação anterior: CI `40896681831` SUCCESS no head `47477d8`.
- Fontes: cobrança vencida e pagamento FAILED → STUDENT_BILLING/OWNER; ausência de presença conhecida por 14 dias → ATTENDANCE_RISK; treino PENDING_REVIEW → ASSESSMENT_WORKOUT; equipamento MAINTENANCE/OUT_OF_SERVICE reportado → EQUIPMENT; CommunicationMessage FAILED de EMAIL/WHATSAPP → DELIVERY_FAILURE; IntegrationConnection TENANT/ambiente atual/DEGRADED → INTEGRATION_HEALTH; limite canônico aplicado ao trial → PLAN_LIMIT; replay/autenticação inválida de dispositivo em AccessEvent → SECURITY/OWNER; falhas auditadas de revalidação provisória/ingestão de mídia → OPERATIONAL_INCIDENT; candidato IA PENDING_REVIEW → HUMAN_APPROVAL.
- Escopo: limite de plano usa o cap de trial realmente aplicado pelo cadastro (`commercial.trial_students_max`), nunca inventa consumo para capabilities sem medidor. Ausência de histórico de frequência não vira zero; sinal de acompanhamento não afirma churn. Desconexão intencional não vira falha. Financeiro da academia continua separado do billing FM.
- Equipamentos: migration aditiva `20261029153000_equipment_operational_status`; API `POST /equipments/:id/operational-status` somente OWNER/MANAGER no tenant ativo, DTO validado, transação/CAS, replay idempotente e auditoria. Estado de seleção `active` preservado. Integração visual desse novo controle segue W01; não declarar botão já disponível.
- Execução: mesmo scheduler existente, paginação limitada e cursores por fonte; todas as famílias são aguardadas mesmo se outra falhar. Erros sanitizados; falha de fonte não bloqueia a outbox. Dedupe persistida permite recuperação após reinício.
- Configuração interna: `MANAGER_ALERT_ATTENDANCE_INACTIVITY_DAYS` (7–90, padrão 14) e `MANAGER_ALERT_PLAN_THRESHOLD_PERCENT` (1–100, padrão 80); flags SCAN/DISPATCH permanecem independentes e desativadas por padrão. Não houve ativação em ambiente externo.
- Testes locais executados: Prisma generate, lint/typecheck, build, 22/22 testes focados e regressão completa 814/814 PASS, zero falhas; diff e sintaxe do script de CI verificados.
- Gate adicional: `scripts/manager-alerts-db-certify.mjs` incluído na CI após fresh migration. Só aceita NODE_ENV=test, HOMOLOG, flag explícita e banco local descartável iron_ci. Valida fontes persistidas, mutation de manutenção, replay, concorrência, financeiro OWNER-only, tenant isolation e minimização de payload. Resultado ainda pendente; testes sintéticos não são homologação externa.
- App: PR #58 preservada; último head consultado `aad3f8f` e CI `40802857324` SUCCESS. Macro O #56 não alterado.
- A6: e-mail/WhatsApp via outbox existentes; push continua adapter/dispositivo pendente, sem token inventado. A10: teste físico Evolution/e-mail/push permanece PENDING_EXTERNAL conforme decisão do usuário.
- Próximo passo obrigatório: consultar CI deste head, corrigir qualquer falha, concluir A9, reconciliar dependência app/backend e gates de merge antes de integrar. Depois seguir o cronograma sem reimplementar fontes concluídas.


## Checkpoint A6/A9 — recuperação e autoridade atual (29/10/2026)

- Candidate de código/testes: `57384f9`, PR #186. Lint/typecheck/build PASS; 27 testes focados PASS; regressão completa 819/819 PASS. Sem merge/deploy.
- A5: a CI `40901321574` aprovou fresh migration e o novo gate PostgreSQL das fontes persistidas, repetição, ingestão concorrente, OWNER financeiro e isolamento entre tenants. A execução completa foi sucedida por novo candidate A6; não confundir esse gate parcial com CI integral do último head.
- A6: leases SENDING expirados recuperados; tentativas esgotadas vão para DEAD_LETTER. Envios revalidam membership/role/academia ativa, categoria, policy, preferência e severidade atuais. Opt-out/perda de autoridade/alerta resolvido → SKIPPED, sem chamar provider. Preferência de quiet hours → DEFERRED, com timezone/DST e sem consumir retry de provider.
- Segurança da caixa interna: leitura, listagem e contadores consultam autoridade atual no banco; uma snapshot histórica de destinatário OWNER não permite ver financeiro/segurança após rebaixamento de função.
- Escalação crítica: somente com policy `criticalEscalationMin`, prazo vencido e alerta OPEN sem reconhecimento; eventKey/dedupe próprios, categoria preservada e exclusão das próprias escalações para impedir loop.
- Script PostgreSQL ampliado para provar demotion de OWNER, recuperação de lease e DLQ usando o mesmo banco descartável; aguardar CI deste candidate para certificar esses novos cenários reais.
- A6 push: adapter/token de dispositivo ainda não implementados; classificar DISABLED/OUT_OF_LAUNCH, nunca SENT nem homologado. E-mail/WhatsApp implementados, homologação física A10 adiada por decisão do usuário.
- Próximo passo: concluir A9 na CI do último head; corrigir qualquer falha, reconciliar app PR #58 e cumprir os gates antes de merge. Depois W01 deve expor o novo estado operacional de equipamento sem alterar o trabalho visual concorrente.


## CURRENT consolidado — PR #186 integrada / A9 em andamento (29/10/2026)

- Backend #186 MERGED: main `51e54d9aa911b08609c49459fb5311d0f01f2e73`; candidate `f80894b` certificado pela CI integral `40903399389` SUCCESS. Regressão local final 820/820 PASS. Pós-merge `40904429721` SUCCESS confirmado.
- A5 DONE_INTERNAL: dez tipos iniciais conectados a fontes canônicas, com testes e PostgreSQL real descartável. Limite de plano monitorado é o cap de trial aplicado pelo cadastro; não inventar medidor para outras capabilities.
- A6 DONE_INTERNAL no launch: recuperação de SENDING expirado, retry/DLQ, revalidação de autoridade/preferência antes de envio, quiet hours/timezone/DST, escalação crítica configurada sem loop. Leituras/listas/contadores também negam financeiro/segurança após demotion de OWNER. Push fora do lançamento e bloqueado na API/UI até haver adapter/registro de dispositivo.
- CURRENT visual: app PR #56 já MERGED na main `3eacb62` pelo outro executor. A antiga regra de esperar #56 não representa mais o estado atual.
- App candidata: PR #60, branch `feat/manager-alerts-premium-reconciled`, head `e2775dbd9b1aded3970c1166c550fb1520cfabb4`, construída sobre main premium. Preserva marca, responsividade, Fiscal, Privacidade, OAuth e módulos atuais. Montagem do inbox e manutenção concluída; 348/348 testes em 80 suítes PASS, typecheck PASS, lint sem erros (24 warnings herdados), exports Web/Android/iOS PASS. CI `40905301576` em execução. PR #58 antiga/conflitante será encerrada como substituída após certificar/integrar #60, nunca mesclada por cima do visual atual.
- Gate A9/I01: backend PR #187, `fix/manager-alerts-live-certification`, atualiza o SHA do app candidato no pipeline para o head real da #60, preservando consumidor legado e toda a matriz. Sem alteração de runtime, infraestrutura ou deploy.
- Homologação física Evolution/e-mail A10 continua PENDING_EXTERNAL por decisão do usuário. Nenhuma integração externa declarada live; nenhum deploy executado.
- Próximo passo: conferir CI #60 e pós-merge backend; resolver falhas do gate cruzado #187; integrar somente com gates verdes; validar pós-merge e encerrar #58 como superseded; seguir cronograma pelos gaps reais. Não confundir conclusão de ALERTAS-1 com GO-LIVE global do IRON.


## Atualização de integração — gates reais (29/10/2026)

- App PR #60 MERGED após CI integral `40905301576` SUCCESS; main `640f2a18441f556c960c191b3e7c0a76bdc55299`. PR #58 encerrada como substituída, com histórico/branch preservados. Pós-merge app `40906217602` em execução na última consulta.
- Backend PR #186 e pós-merge `40904429721` ambos verdes. Sem deploy.
- PR #187 agora também certifica o fluxo HTTP real no E2E operacional existente: alteração de manutenção no domínio real, ingestão pelo produtor canônico, listagem/contadores/read/acknowledge/resolve, tentativa cross-tenant, rejeição de estado inválido e push indisponível. Inbox exercita OWNER/MANAGER permitidos e TRAINER/RECEPTION/STUDENT/SUPER_ADMIN global negados, além de 401 sem autenticação. SUPER_ADMIN global não ganha autoridade operacional de tenant automaticamente.
- Candidate do teste HTTP de seis perfis `c6d20f6`; sintaxe e diff locais verificados. Esses novos cenários HTTP ainda aguardam execução na CI da #187: não marcar PASS antecipadamente. O cenário sem as duas últimas verificações extras já havia entrado no gate anterior; nenhuma evidência externa é inventada.
- Próximo gate: aguardar CI consolidada #187; corrigir qualquer falha real; integrar somente verde e verificar pós-merge. Depois continuar o cronograma pelos gaps comprovados. Homologação física A10 permanece adiada por decisão do usuário; push DISABLED/OUT_OF_LAUNCH.


## Gate final de ALERTAS-1 — versão atual congelada para CI (29/10/2026)

- Backend funcional: #186 integrada em `51e54d9`; CI pré-merge `40903399389` e pós-merge `40904429721` SUCCESS, 820 testes locais PASS.
- App #60 integrada em `640f2a1`; CI pré-merge `40905301576` e pós-merge `40906217602` SUCCESS. #58 fechada como substituída, sem perda de histórico ou código.
- App #61 integrada em `41dc68d5e19247b1a4755ca4cab36bdb73575c21` após CI integral `40907651366` SUCCESS. Corrige uma dependência indevida: Evolution/preferências opcionais não bloqueiam mais o inbox; erros/contagem desconhecida não viram zero nem falso vazio. Regressão 80 suítes/352 testes PASS; typecheck/lint sem erros. Pós-merge da #61 ainda deve ser consultado.
- Gate cruzado #187: o ciclo `40907644651` aprovou HTTP real com seis perfis, migrations/PostgreSQL, consumidores do app, 348 testes da candidata então fixada e navegador real. O overflow transitório após resize foi resolvido aguardando o reflow de useWindowDimensions; limite original de 2px mantido, com diagnóstico de DOM para falha persistente. Não foi alterado o visual nem relaxado o limite.
- O pipeline agora fixa o app final já integrado `41dc68d5e19247b1a4755ca4cab36bdb73575c21` para certificar também o isolamento opcional da #61. Aguardar CI completa deste HEAD da #187 antes de merge. Caso falhe, causa-raiz → corrigir → retestar.
- A10 físico Evolution/e-mail permanece PENDING_EXTERNAL por decisão do usuário. Push DISABLED/OUT_OF_LAUNCH. Nenhum deploy ou alteração em ambiente produtivo foi executado.
- Próximo passo: concluir CI #187 + pós-merge app #61; integrar #187 somente verde; conferir pós-merge backend. Depois seguir as próximas pendências reais do cronograma. ALERTAS-1 interno não representa GO-LIVE global.


## Fechamento do guard de inventário — último gate pendente (29/10/2026)

- App #61 pós-merge `40908511068` SUCCESS. Interface final na main `41dc68d`; 352 testes/80 suítes aprovados, sem skips.
- O ciclo cruzado `40908652079` terminou integralmente SUCCESS, incluindo banco, HTTP dos seis perfis, navegador, ZAP, Command, restart e container.
- A revisão final identificou que a nova mutação de estado operacional precisava validar também a capacidade comercial no servidor. PR #187 passou a incluir o guard: `TenantProductEntitlementsService.resolveFeature(gymId, 'equipment.inventory')` deve retornar FEATURE/true antes de abrir a transação. Sessão válida de OWNER/MANAGER sem essa concessão recebe 403. Reutiliza o resolver canônico; não cria autoridade paralela.
- Testes: negação sem capability sem auditoria/mutação; preservação de tenant/CAS/replay. E2E HTTP injeta suspensão da assinatura somente no banco descartável, espera 403 e restaura o estado em finally; concessão ativa continua validada pelo serviço real. A fixture PostgreSQL de persistência fornece uma concessão sintética explícita, sem fingir que ela é homologação externa.
- Após esse guard: lint/typecheck/build PASS e regressão completa 820/820 PASS novamente. Candidate de código/testes `4c906c2`. Nova CI do HEAD após este checkpoint é obrigatória; não usar o ciclo anterior como aprovação automática do código novo.
- #187 permanece Draft e sem merge até CI completa verde. #186/#60/#61 já integradas e pós-merges verdes; #58 encerrada como substituída. Sem deploy; Evolution físico adiado; push fora do lançamento.
- Próximo passo exato: verificar CI do último head da #187, corrigir se necessário, marcar pronta e integrar com expected_head_sha somente verde; consultar pós-merge e então seguir o cronograma.
