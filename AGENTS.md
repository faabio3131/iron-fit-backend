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
