# IRON D9 / D12 — Autoridade da API de alimentação e configuração no FM Command

Status: **decisão arquitetural aprovada; implementação técnica da ponte específica ainda exige reconciliação**.
Data: 13/10/2026. Escopo: produto IRON FIT CORE real, não um proxy, demo ou aplicação paralela.

## Decisão obrigatória

A **API de alimentação do IRON** e toda API que execute recursos próprios do IRON pertencem operacionalmente ao backend do **IRON FIT CORE**.

O **FM Command** administra as configurações e governança comerciais/corporativas da integração (provider, modelo/endpoint quando aplicável, política, quota, budget, Secret Reference e ciclo de credenciais autorizadas), além de obter **telemetria/métricas, consumo, custos, disponibilidade e auditoria autorizada**, por contratos server-to-server.

O Command **não é** a API runtime do IRON, não recebe as chamadas funcionais da academia ou aluno para repassá-las ao provider, não substitui o IRON como dono da regra de negócio e **não se torna obrigatório na rota crítica de cada uso**.

Fluxos canônicos distintos:

`FM Command (controle) → configuração/versionamento governado + Secret Reference → IRON (controle local e resolução segura)`

`Web/mobile IRON → API IRON (auth/tenant/RBAC/entitlement/policy) → adapter runtime IRON → provider externo → API IRON → Web/mobile`

`IRON (telemetria técnica e consumo faturável) → contrato de observabilidade server-to-server versionado → Command (leitura/contabilização FM)`

O backend IRON aplica a permissão, o tenant, a versão da configuração, o entitlement, timeout, quota operacional, masking, proteção de dados e auditabilidade. A indisponibilidade do Command **não pode modificar autonomamente** uma decisão ou conceder licença; as políticas locais têm validade explícita, fail-closed e renovação governada conforme a integração.

## Estado técnico auditado

No `main@c74567727f98ed018126194bb695dedba0c3a5d0`:
- `src/modules/ai/` contém contratos provider-neutral, registry/provider adapter, resolução de configuração, Secret Reference e execução de IA no runtime do IRON. Existência desses contratos **não comprova provider habilitado/PRODUCTION HOMOLOGATED**.
- `src/modules/integrations/` contém domínio de integrações, catálogo, Secret Vault, referências e controles administrativos próprios do IRON.
- `src/modules/fm-command/` já tem ponte server-to-server autenticada para leitura de fatos e comandos de assinatura/entitlement; não foi comprovado um contrato específico de provisionamento central de API de alimentação/IA nem medição comercial completa do consumo dessas chamadas.
- Busca por `nutrition`, `nutrição` e `alimentação` não localizou uma capability nutricional canônica explícita; portanto, **não é autorizado inventar endpoint alimentar ou alegar integração nutricional live**. A designação usada pelo usuário deve ser reconciliada com a capacidade real antes de codificar operações de domínio.

## Invariantes de segurança

- Credenciais de API da FM pertencem à FM; o assinante academia não injeta chave da FM nem a lê pela Web/mobile.
- Command armazena/gerencia configurações e referências governadas; runtime IRON **resolve referências com least privilege**. Nunca distribuir material secreto, URL de provider arbitrária ou token em fato de telemetria.
- Command **lê** consumos originados da execução do IRON, com proveniência, custo/uso por produto e tenant quando aplicável; não cria medidas sintéticas, não replica prontuários, dietas ou PII desnecessária.
- Alteração central de provider/profile não concede novo papel, entitlement ou acesso a dados. Backend IRON é a autoridade.
- Erro do Command não obriga redirecionamento de toda a operação de IRON por ele. Sem configuração ativa/válida, IRON falha de forma segura segundo o contrato canônico, sem credencial de contingência livre.
- Uso de IA em treino mantém revisão humana e IA advisory.

## Próxima reconciliação técnica

`CAPACIDADE concreta → domínio IRON canônico → API existente → Web/mobile → role/permission/entitlement → configuração vigente → provider/Secret Reference → telemetria → Command → gap implementável`.

Construir apenas os contratos faltantes de **control-plane de configuração** e **usage-metering/reporting** em torno da API runtime real, com assinatura/autenticação server-to-server, versionamento, idempotência, replay, tenant isolation, quotas, audit e testes de falha/desconexão. Não criar endpoint fictício por falta de definição do provider/capacidade, nem proxy de inferência genérico no Command.

A integração e seus provedores só podem ser classificados como `PRODUCTION HOMOLOGATED`, `SANDBOX HOMOLOGATED`, `IMPLEMENTED/EXTERNAL BLOCKER` ou `DISABLED/OUT OF LAUNCH` com evidência real.
