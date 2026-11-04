# Execução do piloto — 04/11/2026

## Decisão vigente

O cliente entra por **Testar grátis**, cria a academia e convida a equipe. Sem seed, senha padrão, concessão especial de entitlement ou cadastro manual pelo executor. PR #216 encerrada sem merge.

## Fases sequenciais e gates

| Fase | CURRENT | Gate restante |
| --- | --- | --- |
| 1 — Entrada oficial | PR #217 integrada em a5e8430; CI pré-merge 41872805440 SUCCESS e pós-merge 41874060440 SUCCESS. Navegador real no app 12e74e8f prova trial de 30 dias, persistência, idempotência, OWNER exclusivo, convites e login da equipe. | Entrada real feita pelo próprio cliente; não é requisito para programar os blocos internos. |
| 2 — Recepção/matrícula/caixa | Implementação candidata nesta branch; catálogo de planos academia→aluno, política OWNER+step-up opt-in, liquidação canônica atômica, recibos de atribuição/idempotência, renovação por cobrança existente e fechamento do operador. CPF validado, nascimento e URL HTTPS de foto no cadastro. | Testes/CI cruzados, navegador e merge ainda pendentes. |
| 3 — Equipamentos/treinos | Domínios existentes preservados; não reimplementar catálogo, prescrição manual nem revisão humana de candidato IA. | Reconciliar cinco fichas-modelo e seleção dos equipamentos reais; API/modelo real apenas com credencial governada. |
| 4 — Terminal/portaria | Access Center e drivers multimarcas existentes; decisão QR não comprova giro de catraca. | Terminal de recepção, busca/QR e dez acessos controlados precisam ser reconciliados/certificados. Homologação física segue externa. |
| 5 — Android/iOS | CI exporta bundles Web/Android/iOS; EAS preview gera APK, production gera AAB. | APK assinado com URL real, distribuição segura e aparelho real. iOS requer distribuição própria; APK não comprova iOS. SDK Android/EAS CLI ausentes no PC observado. |
| 6 — Ensaio/go-live | Runbooks e observabilidade existentes, sem GO declarado. | Ensaio completo, backup/restore real, equipe treinada e abertura real em 09/11 06h00 exigem evidência. |

## Fronteira de segurança da Fase 2

- Financeiro `/financial/*`, fiscal, SaaS billing, contas, estornos e conciliação continuam OWNER/step-up. Recepção não ganha esses menus nem APIs.
- Somente OWNER com step-up cadastra planos e autoriza a conta de recebimento do balcão. Política desabilitada por padrão; matrícula/pagamento falham fechados até autorização.
- `/reception/*` exige OWNER ou RECEPTION no tenant da sessão e revalida membership/academia/operador atuais no servidor. Não aceita tenant, preço, conta ou operador escolhidos pelo cliente no checkout.
- Valores vêm do plano canônico da academia. Recibo só atribui operador e idempotência; Charge e FinancialTransaction continuam fonte financeira. Sem novo ledger econômico.
- Matrícula, primeira cobrança, liquidação, handoff fiscal, auditoria e recibo usam a mesma transação SERIALIZABLE. Falha desfaz todo o conjunto. Pagamento de cobrança existente usa o mesmo FinancialService.
- Dinheiro/Pix/crédito/débito são registros manuais de pagamento presencial já conferido. Não há captura de PAN/CVV ou gateway fictício. Cobrança vinculada ao gateway continua exigindo confirmação do provider e não pode ser baixada manualmente.
- Relatório da recepção contém somente recebimentos do operador atual; estornos deixam de compor o total recebido.
- Planos mensais/trimestrais/semestrais/anuais definem prazo, não prometem débito automático de cartão. Uma cobrança subsequente já existente pode ser recebida sem criar nova matrícula.
- CPF é opcional, normalizado/validado e único por academia; não é identificador global para vincular ou revelar contas. Foto é URL HTTPS; nenhum upload/download ou consentimento biométrico é inventado.
- Migration aditiva e repetível, com teste de replay no PostgreSQL da CI. Sem aplicação em produção nesta entrega.

## Ambiente observado

Leitura SSH de 209.126.84.250 em 04/11 confirmou serviços de outro produto e Evolution, sem container IRON em execução. Não alterados. Isso não prova que o IRON não exista em outro servidor. Não publicar em infraestrutura de outro produto por suposição. O destino piloto do IRON ainda requer confirmação reproduzível. Sem deploy nesta execução.

## Continuidade

Concluir CI da Fase 2, corrigir causas-raiz, integrar somente verde e conferir pós-merge. Depois executar os gaps internos das Fases 3–6 sequencialmente. A ausência de homologação física não autoriza marcar GO-LIVE CERTIFIED.
