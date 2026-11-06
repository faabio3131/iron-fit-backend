# Piloto IRON — checkpoint vigente — 04/11/2026

O cliente entra por **Testar grátis → cadastro → provisioning canônico → login OWNER → convite da equipe**. PR #216 do seed encerrada sem merge. Não criar cadastro real ou concessão de entitlement por fora dessa jornada.

Repositórios: faabio3131/iron-fit-backend e faabio3131/iron-fit-app (Web/mobile). O tenant atual é Gym; GymUnit não existe no CURRENT. Antigo web-platform não deve ser usado.

| Fase | CURRENT comprovado | Próximo gate |
| --- | --- | --- |
| 1 — Entrada oficial | CERTIFIED_INTERNAL: #217 main a5e8430; CI pré 41872805440 e pós 41874060440 SUCCESS. Navegador prova trial de 30 dias, assinatura/OWNER únicos, replay e equipe. | Uso real pelo próprio cliente; não bloqueia construção interna. |
| 2 — Recepção e caixa | CERTIFIED_INTERNAL: backend #218 main af86fa2 e app #83 main b0f161c; CI pré 41877912066/41877081658 e pós 41880622803/41880677293 SUCCESS. 937 testes backend, 390 app e 9 jornadas HTTP/PostgreSQL 18 PASS. | Publicação e operação do cliente permanecem gates separados. |
| 3 — Equipamentos e treinos | CERTIFIED_INTERNAL: backend #219 main 3963eb0 e app #84 main 862620e. CI pós-merge 41886487686/41886501492 SUCCESS. | Fluxo certificado em ambiente isolado. |
| 4 — Terminal e portaria | IMPLEMENTED_CANDIDATE: backend #220 e app #85. Terminal por aluno/QR, decisão e auditoria transacionais, QR temporário do aluno. | CI integrada, merge e pós-merge. Leitor USB e catracas reais exigem evidência operacional. |
| 5 — Android/iOS | CI existente exporta bundles. EAS preview produz APK; production produz AAB. | APK assinado, URL real, distribuição e aparelhos reais. APK não instala no iOS. SDK Android/EAS CLI ausentes no PC observado. |
| 6 — Ensaio e abertura | Runbooks e observabilidade existentes; GO não declarado. | Ensaio com terminal, destino piloto, backup/restore operacional, treinamento e abertura real em 09/11 às 06h00. |

## Fronteiras preservadas

- Financeiro administrativo, contas, estornos, fiscal e billing FM continuam OWNER/step-up. A recepção só usa balcão opt-in, com planos/conta autorizados pelo OWNER e valores definidos pelo servidor. Não há captura de PAN/CVV.
- Matrícula, cobrança, liquidação financeira canônica, handoff fiscal, auditoria e recibo são uma transação SERIALIZABLE. Recibo só atribui operador/idempotência; Charge e FinancialTransaction são a fonte financeira. Gateway nunca é confirmado por checkbox.
- Fechamento é do operador atual; estorno deixa de compor o total recebido. CPF é opcional, validado/único por academia e completo somente para OWNER/MANAGER/RECEPTION. Não vincula contas entre tenants.
- Modelos preenchem o composer, sem gravar ou aprovar. POST canônico cria DRAFT e revisão/ativação humanas são etapas distintas. Falha do endpoint de modelos não impede composição manual. Aparelho em manutenção é recusado na prescrição e no seletor de compatibilidade.
- IA real depende de provider/credencial governados da FM. Modelos manuais não são prova de IA homologada. Wellhub/TotalPass, Evolution, fiscal, gateways e catracas não ganham homologação por CI.
- Node-forge transitivo corrigido para 1.4.3; auditoria PASS sem exceção nova. A exceção Zod herdada mantém o prazo original.

## Ambiente observado

Leitura SSH de 209.126.84.250 encontrou serviços de outro produto/Evolution, sem IRON produtivo naquele momento. Não prova ausência em outro servidor nem autoriza escolher destino por suposição.

Uma certificação usou PostgreSQL 18 e Node 22 em contêineres descartáveis na Contabo, limitados por CPU/memória e sem portas públicas. O candidato 5355bbd aprovou 9/9 jornadas HTTP, incluindo recepção, concorrência e isolamento. Contêineres/ambiente sintético removidos, conferido por docker ps. Nenhuma base produtiva ou serviço existente foi alterado; sem deploy do produto.

## Continuidade

Concluir a CI do backend #220 e app #85, corrigir e integrar com o gate verde. Depois avançar à distribuição móvel e ao ensaio. O cliente piloto entra pelo botão Testar grátis.
