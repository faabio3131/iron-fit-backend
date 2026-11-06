# Piloto IRON — checkpoint vigente — 06/11/2026

O cliente entra por **Testar grátis → cadastro → provisioning canônico → login OWNER → convite da equipe**. PR #216 do seed encerrada sem merge. Não criar cadastro real ou concessão de entitlement por fora dessa jornada.

Repositórios: faabio3131/iron-fit-backend e faabio3131/iron-fit-app (Web/mobile). O tenant atual é Gym; GymUnit não existe no CURRENT. Antigo web-platform não deve ser usado.

| Fase | CURRENT comprovado | Próximo gate |
| --- | --- | --- |
| 1 — Entrada oficial | CERTIFIED_INTERNAL: #217 main a5e8430; CI pré 41872805440 e pós 41874060440 SUCCESS. Navegador prova trial de 30 dias, assinatura/OWNER únicos, replay e equipe. | Uso real pelo próprio cliente; não bloqueia construção interna. |
| 2 — Recepção e caixa | CERTIFIED_INTERNAL: backend #218 main af86fa2 e app #83 main b0f161c; CI pré 41877912066/41877081658 e pós 41880622803/41880677293 SUCCESS. 937 testes backend, 390 app e 9 jornadas HTTP/PostgreSQL 18 PASS. | Publicação e operação do cliente permanecem gates separados. |
| 3 — Equipamentos e treinos | CERTIFIED_INTERNAL: backend #219 main 3963eb0 e app #84 main 862620e. CI pós-merge 41886487686/41886501492 SUCCESS. | Fluxo certificado em ambiente isolado. |
| 4 — Terminal e portaria | CERTIFIED_INTERNAL: backend #220 (1539ef7) e app #85 (a87ffc6). CI pós-merge 42236552074/42236564797 SUCCESS. Dez decisões no navegador, QR via teclado, replay e auditoria no PostgreSQL. | Leitor USB e aparelhos reais na bancada. |
| 5 — Android/iOS | Bundles Android/iOS íntegros na CI 42236564797. O perfil preview atual gera APK Android e usa simulador no iOS. | BLOCKED_EXTERNAL: URL homologada e projeto de assinatura Expo/EAS sem acesso neste ambiente. Instalação Android e TestFlight em aparelhos reais pendentes. |
| 6 — Ensaio e abertura | Ensaio automatizado passou na CI 42236552074, com navegador/API/PostgreSQL, backup/restore descartável e recuperação após reinício. | Ensaio presencial, validação de backup/restore do ambiente piloto, treinamento e decisão GO. |

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

Abrir os gates operacionais abaixo no ambiente aprovado. O cliente piloto entra pelo botão Testar grátis.


## Validação de campo

1. Confirmar Web/API do piloto e rodar o preflight de borda existente com o SHA implantado e o ambiente esperado. Conferir DNS, TLS, CORS e readiness. Registrar também backup, restauração e retorno à revisão anterior com o responsável pela operação.
2. Vincular o projeto Expo/EAS oficial, confirmar o certificado esperado e gerar APK interno Android com a API aprovada. Verificar assinatura, identificador `com.faabio3131.ironfit` e SHA-256 antes de disponibilizar o link. Distribuir iOS por TestFlight, com build para aparelho e identificador `com.ironfit.app`.
3. Validar em Android e iPhone o login, tenant, perfil, treino, agenda, QR temporário e logout. Registrar versão do app, modelo do aparelho e resultado. Na estação da recepção, ler um QR real pelo USB em modo teclado e comprovar decisão e registro único de auditoria. Conferir também QR vencido e acesso negado. Registrar confirmação de passagem em catraca apenas se houver equipamento homologado e evidência de giro.
4. Ensaiar a partir de Testar grátis em ambiente piloto autorizado. O cliente real faz o próprio cadastro. Validar convite da recepção e do treinador, matrícula, recebimento controlado, treino, QR e fechamento. Registrar operador, horário, evidências e decisão GO.

Na estação conectada, a inspeção encontrou um dispositivo USB genérico, sem identificação como leitor, e não confirmou aparelho conectado. ADB e CLI EAS indisponíveis. Nenhuma sessão Expo ou variável EXPO_TOKEN ativa foi confirmada. A listagem de credenciais e variáveis no nível do repositório do app retornou vazia, sem inspeção de valores de segredos.
