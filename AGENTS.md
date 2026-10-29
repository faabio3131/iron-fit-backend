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
| A1 | Schema/migration de alerta, destinatário, preferência, entrega e deduplicação | Fresh migration + rollback lógico + índices tenant-scoped + Prisma validate | `IMPLEMENTED/CI_PENDING` |
| A2 | Serviço canônico de ingestão, dedupe, lifecycle e auditoria | Unidade/integração cobrindo concorrência, replay, RBAC e cross-tenant | `IMPLEMENTED/PARTIAL_TESTS` |
| A3 | APIs do painel: inbox, contadores, filtros, ler, reconhecer, resolver, dispensar | Contratos paginados; OWNER/MANAGER; fail-closed; testes HTTP/RBAC | `IMPLEMENTED/CI_PENDING` |
| A4 | Preferências, quiet hours, severidade mínima e políticas governadas | Preferência individual; política tenant com step-up; segurança não silenciável | `IMPLEMENTED/CI_PENDING` |
| A5 | Produtores dos 10 alertas aprovados | Cada produtor tem evento/dedupe/evidência e teste; sem cron duplicado | `NOT_STARTED` |
| A6 | Outbox e adapters painel/e-mail/push/WhatsApp | Painel sempre disponível; retry/lease/DLQ; provider externo pode ficar blocked | `NOT_STARTED` |
| A7 | Evolution no IRON: control-plane FM, instância por academia, QR/status/webhook | Engenharia interna + testes; segredo global não entregue ao tenant; homologação real separada | `NOT_STARTED` |
| A8 | Web Premium e Mobile: sino, badge, inbox, detalhe, ações e preferências | Desktop/tablet/mobile; acessibilidade; zero clicável falso; seis perfis testados | `NOT_STARTED` |
| A9 | Certificação consolidada backend/app | lint, typecheck, testes, migrations, build, exports, container e regressão verdes | `NOT_STARTED` |
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
- backend branch/PR/SHA: `feat/alertas-gestor-v1` / PR #186 (draft) / head remoto `39760ad` antes da fatia A4;
- app branch/PR/SHA: `não iniciado — backend primeiro`;
- migrations: `20261029010000_manager_alerts_core` implementada; validação Prisma aguarda CI porque o executor não possui dependências npm;
- testes backend: `manager-alerts-boundary.test.mjs` 4/4 verde após preferência individual; suíte completa aguarda CI;
- testes app: `não iniciados`;
- CI: `em execução na PR #186`;
- deploy: `não autorizado nesta ordem`;
- homologação Evolution/e-mail/push: `PENDING_EXTERNAL`;
- próximo passo: publicar política tenant A4, corrigir gates da CI e instrumentar os produtores A5; não declarar migration/build verdes antes da CI.
