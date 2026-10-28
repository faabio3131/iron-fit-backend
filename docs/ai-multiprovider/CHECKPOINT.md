# IRON AI Multi-Provider — checkpoint

## AI-MP-00 — 2026-10-28 UTC

- Backend base: main `664ecc6bb90e506a330705bc52a9697cbdec9fb9`.
- Trabalho concorrente preservado: PR #178, branch `feat/iron-ai-multiprovider-runtime-20261027`, snapshot `d52f1309155b39ddd50c00999b3ebbfea4b05533`, CI #40619828642 SUCCESS consultada.
- Branch deste executor: `feat/ai-multiprovider-closure`, baseada nesse snapshot; não sobrescrever branch #178.
- App referência: PR #56 `36f2756301fa363696d22489c50e0321ad701106`, sem alterações nesta frente.
- KEEP: contratos canônicos, profiles Prisma, Vault/Integration Fabric, RBAC, entitlements, quatro capacidades, validação de saída e candidato sob revisão humana.
- ADAPT: transports da PR #178, configuração administrativa, limites/cancelamento, proveniência.
- IMPLEMENT: rotas fallback explícitas, orçamento concorrente, circuito, métricas de tentativas, testes adversariais/integrados.
- Schema: inspecionado no repositório; nenhum banco produtivo consultado/alterado.
- Ambiente: local isolado; nenhum deploy, credencial real ou chamada tarifada.
- Gates pendentes: AI-MP-01–09. Não declarar homologação externa com mocks.

## Candidata interna — AI-MP-01–07

- Adapters da PR #178 preservados e endurecidos: HTTPS/destino/protocolo/modelo, DNS validado no socket, leitura limitada, timeout/cancelamento, redaction e formatos das quatro capacidades.
- Admin: SUPER_ADMIN e step-up, Vault GLOBAL FM, perfil TENANT não aceita credencial de academia, destinos de credencial vinculados e fallback explícito.
- Orquestração: fail-closed, fallback após falha transitória, retry limitado de 429, circuito local, orçamento durável por versão e replay/concurrency por tentativa.
- Observabilidade: provider/model/prompt/request, hash, latência, uso reportado e estimativa opcional por tarifa; valores ausentes preservados como desconhecidos. Nenhuma chamada tarifada.
- Testes locais: `npm run ci` PASS com ambiente efêmero (segredos sintéticos gerados em memória); 788 PASS, 0 FAIL, 0 SKIP. O conjunto AI-MP possui 30 casos, incluindo HTTP local, protocolos, domínios, guards, fallback, custos e configuração.
- Build, lint/typecheck, diff check e varredura de segredos com novos arquivos staged: PASS.
- Concorrência PostgreSQL e instalação limpa da migration aguardam CI. Servidor PostgreSQL local indisponível; instalação falhou por restrição do ambiente, não por falha demonstrada da migration.
- CI remota desta candidata, PR e merge: pendentes. CI da PR #178 não certifica este novo código.
- AI-MP-08: nenhuma credencial real/chamada externa autorizada ou executada nesta frente; homologação externa pendente.
- AI-MP-09: depende de CI PostgreSQL, revisão final, PR/merge elegível e pós-merge. Deploy físico permanece sob responsável pela migração.
- Próximo passo: publicar branch isolada, certificar CI, corrigir eventual falha e atualizar este registro. Não alterar PR #56/branch visual nem a branch da PR #178.

## Blocker de publicação — 2026-10-28 UTC

- Commit de implementação local: `2644a2cb20cb4a4416338322160a6e4cdb9dc437`.
- Prisma validate: PASS após definir DATABASE_URL sintética local; não conectou a banco produtivo.
- Dependency audit high gate: exit 0; não significa ausência de avisos de menor severidade.
- `git push -u origin feat/ai-multiprovider-closure` rejeitado pela revisão automática de aprovação. Motivo informado: autorização ampla do projeto não foi aceita como autorização explícita para enviar código backend/schema/migration/testes/documentação ao destino GitHub.
- Não contornado por connector, outra branch ou método de upload. CI PostgreSQL, PR, merge e pós-merge permanecem PENDENTES, não certificados.
- Ação necessária: autorização explícita para publicar esta branch no repositório `faabio3131/iron-fit-backend`. Isso não aplica a migration em produção nem autoriza chamadas tarifadas.

## Autorização de publicação — 28/10/2026 BRT

O proprietário autorizou explicitamente publicar a branch, código, migration, testes e documentação e abrir a PR. O bloqueio de aprovação anterior está resolvido. Git HTTPS local não possui credencial de escrita; publicação pelo conector autenticado, verificando equivalência da árvore com o conteúdo local validado. CI/merge/homologação externa ainda dependem dos respectivos gates.

## CI inicial e reconciliação do consumidor — 28/10/2026 BRT

- PR #179 publicada: backend `5e6c3c9c656dd9b9bab1ae1501443f30401224b7`; árvore idêntica ao conteúdo local.
- CI PR #40630267718 e push #40630263843 SUCCESS no mesmo SHA. PostgreSQL confirmou migration, replay concorrente, orçamento, isolamento e versão desabilitada; 788 testes backend PASS, zero skips. Backup/restore, E2E API, navegador, Command, reinício e container PASS.
- ZAP passivo: 0 FAIL, 7 avisos; não equivale a DAST ativo nem homologação externa.
- Limite identificado no workflow herdado: candidato Web era PR #22 `2ba90ee5`, com 189 testes PASS e 1 live separado ignorado na suíte comum. O teste live foi executado em passo próprio. Não chamar isso de certificação da PR #56.
- Atualizada referência imutável do consumidor para PR #56 `36f2756301fa363696d22489c50e0321ad701106`, preservando `IRON_LIVE_E2E=true` somente no passo dedicado. Nenhum arquivo/branch do app modificado.
- Nova CI necessária para comprovar interoperabilidade com essa candidata. Merge ainda não realizado.

## Jornada atualizada do consumidor — 28/10/2026 UTC

- CI #40631054274 confirmou backend, PostgreSQL, testes e exportação do app #56, mas falhou na jornada browser que ainda esperava o antigo formulário de equipe. Falha não tratada como PASS.
- Adaptado somente o teste backend ao convite atual, definição de senha pela API canônica (token da entrega isolada, mesmo procedimento do E2E de identidade), três funções e inventário com confirmação. Preservados login real por função, negativas RBAC e roundtrip persistente. Nenhum arquivo do app alterado.
- Reteste remoto obrigatório antes do merge; homologação externa e deploy continuam pendentes.

## Integração e correção pós-merge — 28/10/2026 UTC

- PR #179 integrada em `af028e564b0b6674bb76f7e526b02eb81c967413`; PR #178 reconhecida como integrada por ancestralidade, sem sobrescrever seu trabalho.
- CI da candidata #40632133078 SUCCESS: 788 testes backend, 342 app, navegador real em 20 módulos, PostgreSQL, Command, restart e container. ZAP passivo: 0 FAIL / 7 WARN.
- Pós-merge #40632800105 falhou de forma intermitente no teste browser ao cadastrar aluno. Código da Web agenda o carregamento do módulo; teste podia preencher antes desse carregamento e perder a ação. Não declarar AI-MP-09 concluído com esse resultado.
- Correção isolada do teste: aguardar GET canônico e término de loading nas telas de equipe/aluno/equipamento; observar respostas e cliques juntos, incluindo reload após criação. Nenhuma asserção de domínio/RBAC removida. PR e CI da correção serão registradas na PR vinculada.
- AI-MP-00–07 implementados; AI-MP-08 IMPLEMENTED/EXTERNAL BLOCKER; AI-MP-09 aguardando correção e pós-merge verde. Nenhuma homologação externa, implantação ou alteração de infraestrutura executada.
