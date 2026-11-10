# IRON FIT CORE — Política comercial candidata 4 tiers / Cakto

**Auditado:** 09/11/2026. **Estado:** CANDIDATE_NOT_PUBLISHED; sem autorização para divulgar como oferta funcional ou migrar clientes atuais automaticamente.

## CURRENT reproduzível / autoridade

- IRON Backend: `config/commercial/iron-v1-launch.json` ainda define `IRON_V1` (R$ 269 mensal / R$ 2.690 anual) e `IRON_V1_TRIAL`. Banco produtivo já confirmou somente estes planos publicados. NÃO sobrescrever ou reprecificar a versão histórica.
- IRON fornece `ProductPlan` -> `ProductPlanVersion` -> `SaasPlanPrice` e `ProductPlanEntitlement` governados; alteração de plano e limites deve ocorrer no backend canônico, com revisão profissional de treinos gerados por IA.
- FM Command V1 é billing authority da plataforma (academia paga FM); academia/aluno é domínio financeiro separado.
- FM Command tem `IronVersionedPlanMapping` imutável (commercialPlanCode -> ironPlanCode + version), permitindo preços mensal/anual com **códigos comerciais distintos** para cada um dos quatro planos canônicos. Checkout exige fatura com ID e `sck` na URL da Cakto. PR #217 corrige o catálogo e a pré-verificação que indevidamente exigiam igualdade dos dois códigos.
- Conta Cakto PF acessível no Chrome do proprietário. Uma oferta experimental `IRON FIT CORE V1 - Mensal` R$ 269 foi criada durante a engenharia, depois **desativada e confirmada pelo painel**, pois a ligação fatura/assinatura ainda não estava homologada. Não tratar como uma oferta viva.
- Ainda NÃO há quatro plans tiers publicados nem oito checkouts homologados. Checkout comercial e outbox Cakto permanecem controlados por gates.

## Referências externas, não preços canônicos do IRON

- Tecnofit: preço variável por alunos ativos, taxa de implantação e planos Starter/Business/Pro. A página comercial mostra R$269/mês no seletor atual; outro texto da própria empresa cita entrada R$149/mês para 50 alunos. É dependente de porte/cenário, não uma cotação universal. Fonte: https://www.tecnofit.com.br/precos/ e https://www.tecnofit.com.br/blog/quanto-custa-um-sistema-para-academia/
- Cloud Gym (tabela pública): Studio R$89,90 até 200 clientes + implantação; Safira R$299,90 sem limite declarado; Suíte R$429,90; Infinity R$649,90. Fonte: https://cloudgym.com.br/
- UNAFIT (foco boxes): Starter R$99,90 até 50, Pro R$199,90 até 200, Scale R$349,90 ilimitado declarado. Fonte: https://unafit.com.br/
- Next Fit/Pacto/ABC EVO: tabela fechada ou sob consulta; não usar estimativas de blogs como preços oficiais.
- Kaizer: USD49 até 50 / USD129 até 250 / USD199 até 1000; não comparar sem converter moeda/câmbio e sem respeitar sua cobrança em USD. Fonte: https://gyms.kaizer.app/pt/precos

## Quatro famílias comerciais candidatas

| Família canônica | Mensal | Anual (cobrado anualmente) | Equivalente mensal anual | Alunos | Treinos IA/mês | Unidades |
|---|---:|---:|---:|---:|---:|---:|
| IRON_START | R$147 | R$1.428 | R$119 | 100 | 50 | 1 |
| IRON_GROWTH | R$297 | R$2.964 | R$247 | 300 | 200 | 1 |
| IRON_SCALE | R$497 | R$5.004 | R$417 | 700 | 500 | 1 |
| IRON_ENTERPRISE | R$897 | R$8.964 | R$747 | 1.500 | 750 | 3* |

* O teto multiunidade é **proposta técnica ainda não certificada**, não promessa comercial. As cotas devem ser implementadas com contador idempotente, janela mensal e limites canônicos antes de ativação.
* NÃO prometer alunos/IA ilimitados; definir comportamento no limite (não suspender recepção/check-in, negar somente nova operação excedente quando seguro e permitir upgrade).
* Todos os planos recebem a **base de módulos comercialmente homologados** (não todos os adapters ou funcionalidades fora de launch), sujeitos a RBAC, role, tenant, entitlements e step-up.
* Assinatura anual é cobrança de 12 meses em uma operação com renovação anual; não confundir com 12 pagamentos mensais com fidelidade. Parcelamento no cartão é condição do checkout, taxas precisam ser conferidas no painel.

## Unit economics — taxas Cakto e teto do custo direto

Taxas divulgadas publicamente em setembro/2026 (confirmar contrato efetivo): Pix R$2,49/compra; cartão padrão 4,99% do valor + R$2,49; 3DS acrescenta 2%; Apple Pay/Google Pay 8,99% + R$2,49; saque R$4,59 por solicitação conforme central de ajuda (há divergências de textos publicitários quanto a liberação Pix/saque). Fontes:
- https://www.cakto.com.br/taxas
- https://ajuda.cakto.com.br/pt-br/articles/72-quais-sao-as-taxas-da-plataforma-cakto
- https://ajuda.cakto.com.br/pt-br/articles/30-como-me-cadastrar-na-cakto

Assumindo 100% de vendas no cartão padrão, sem parcelamento custeado pela FM, tributos, chargebacks, anúncios, afiliados ou custo de saque rateado:

| Plano | Sobra mensal após Cakto | Sobra do anual por mês de serviço | Teto COGS mensal para >=60% margem | Teto COGS no anual para >=60% margem |
|---|---:|---:|---:|---:|
| Start | R$137,17 | R$112,85 | R$48,97 | R$41,45 |
| Growth | R$279,69 | R$234,47 | R$101,49 | R$86,27 |
| Scale | R$469,71 | R$395,98 | R$171,51 | R$145,78 |
| Enterprise | R$849,75 | R$709,52 | R$311,55 | R$261,32 |

Formula por transação cartão: `fee=round(0.0499*price+2.49)`. No anual, amortizar em 12 meses para comparar mensalidades. Teto direto de 60% margem: `0.40*receita_bruta_mensal_equivalente-taxa_cakto_mensal_equivalente`. Margem direta nao e lucro liquido.

**Não há inventário financeiro real e verificado** de infraestrutura alocada por tenant, tokens/custos de modelos, suporte, canais, taxes/IRPF/ISS, reembolsos, CAC e churn. Não declarar lucro líquido ou margem certificada. Em IRON, o endpoint S2S `ai-usage` divulga quantidade de traces e registra explicitamente que tokens e custo de provider estão indisponíveis.

### Guardrails de lucratividade antes da publicação

1. Instrumentar medição por tenant e operação: tokens/modelo/taxa/custo de IA, WhatsApp por mensagem, storage, banda, DB/compute, suporte/hora, incidentes, taxas efetivas Cakto, chargeback, antifraude, impostos e aquisição de clientes.
2. Determinar custo marginal mensal em percentil p90/p95 de cada tier, e preço de bloco extra de IA sem permitir overrun ilimitado.
3. Confirmar se as cotas de alunos refletem `matrículas ativas`, não alunos totais ou usuários pessoais, e aplicar fonte canônica; upgrades suaves sem interromper controles de acesso físico, sem ampliar entitlement no frontend.
4. Evitar taxa de implantação obrigatória no self-service; oferecer **serviço de migração assistida pago** quando existir operação/escopo contratual e preço comprovado.
5. Receita futura de spread em pagamentos academia->aluno fica **R$0 no forecast** até contrato/acordo regulatório e integração; esse dinheiro não pertence automaticamente à FM.
6. Cakto aceita CPF, mas exige regularização cadastral para saque. Contabilidade/tributação e eventual obrigação de nota não desaparecem por usar CPF. Site mostrou NFSe indisponível até CNPJ.

## Fluxo correto site -> Cakto

Visitante na página FM ou ironfitcore.com.br -> escolhe uma das 4 famílias e o período -> cadastro/autenticação da **academia real** no IRON e step-up do OWNER quando necessário -> serviço comercial IRON solicita fatura idempotente no FM Command V1 -> Command resolve mapeamento canônico e preço imutável, vincula `gymId`, inscrição e invoice UUID -> responde URL oficial `pay.cakto.com.br` com `sck=<invoiceId>` -> navegador abre checkout Cakto -> pagamento aprovado em webhook raw-body assinado -> Command concilia o evento e outbox -> IRON aplica entitlement em S2S autorizado; renovação, reembolso, chargeback e cancelamento governados.

Um link Cakto **estático e público sem invoice/tenant vinculados não pode substituir o fluxo**, pois não identifica corretamente a academia pagante nem ativa licença, e pode criar cobrança sem entrega. O cliente deverá chegar à Cakto no ato de assinar, com redirecionamento automático **após** o cadastro essencial; não se deve prometer ativação por e-mail do pagador isolado.

## Sequência de implementação no produto real

A. Reconciliação de capacidades e validação da política de limites por módulo. Criar quatro `ProductPlan` com versões novas PUBLISHED sem alterar a atual `IRON_V1`; aplicar entitlements conservadores e quotas com testes por tenant.
B. Definir oito `SaasPlanPrice` imutáveis mensais/anuais e oito commercialPlanCode FM Command, cada um mapeado à mesma versão do tier correto. Corrigir/validar o catálogo comercial (PR #217) para ofertas mensal/anual.
C. Criar quatro produtos Cakto com duas ofertas recorrentes (mensal/anual) cada; recolher ID real, URL oficial e webhook secret do próprio painel, sem expor segredo em logs. Oferta provisória de R$269 desativada, não reutilizar.
D. Revisar site FM (atualmente preço R$269 e trial 15 dias) e IRON: pricing responsivo Premium em quatro cards com seletor mensal/anual, valor verificado, CTA de signup -> checkout Cakto com fatura; backend tem trial canônico 30 dias / 15 alunos na matriz V1, conferir aplicação real antes de trocar copy.
E. Testar cadastro -> owner -> checkout -> venda Cakto autorizada -> webhook -> invoice -> outbox -> IRON ativo, upgrades, downgrades, refund e suspensão; CI, diff, deploy e rollback. Gate GO-LIVE apenas com evidência da transação real e licença validada em Web/mobile.

**Não ativar o scheduler Cakto ou publicar cartões como disponíveis até B–E passarem.** 
