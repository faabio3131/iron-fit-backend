# IRON-CN8 — Commercial Rules + Revenue Share + Settlement

Data: 05/09/2026  
Baseline: `main @ 37cc913237192d6874166e0ac0fa1f974cd01d89`

## 1. Objetivo

CN8 materializa o domínio comercial do Creator Network sem misturá-lo com contabilidade da academia, cobrança de aluno ou settlement do Aggregator Hub.

O bloco cria quatro camadas canônicas:

1. Commercial Agreement;
2. Commercial Rule Version;
3. Commercial Accrual;
4. Creator Settlement Batch + Items.

CN8 consome fatos imutáveis do CN7 e não altera o significado desses fatos.

## 2. Separação financeira obrigatória

CN8 não reutiliza nem escreve em:

- `FinancialTransaction`;
- `Payable`;
- `Subscription` financeira do aluno;
- `Charge`;
- `GatewayConnection`;
- `AggregatorSettlement`;
- Product Plan / Product Entitlements.

Esses domínios possuem autoridades e semânticas diferentes.

Um creator accrual não é receita da academia e um `AggregatorSettlement` recebido pela academia não é creator payout.

## 3. Beneficiário comercial

O beneficiário do Commercial Agreement é um `CreatorRightsHolder`, não automaticamente o `Creator` creditado editorialmente.

No registro do agreement o serviço exige:

- conteúdo no mesmo escopo GLOBAL/TENANT;
- Rights Grant ACTIVE e vigente;
- Rights Holder ACTIVE;
- consentimento vigente quando exigido pelo Rights Vault;
- `beneficiaryRightsHolderId` exatamente igual ao Rights Holder ACTIVE do conteúdo.

O nome legal do beneficiário é congelado no agreement e novamente no accrual/settlement para preservar evidência histórica.

## 4. Commercial Rule Version

As regras são versionadas e seus termos são imutáveis. Alterar termos exige nova versão.

Estados:

- `DRAFT`;
- `ACTIVE`;
- `SUPERSEDED`;
- `REVOKED`.

Existe fisicamente no máximo um DRAFT e um ACTIVE por agreement.

Ativação de nova versão supersede atomicamente a versão ACTIVE anterior. Uma rule futura permanece DRAFT até seu `effectiveFrom`; uma rule expirada não pode ser ativada.

CN8 não permite monetização retroativa: um evento CN7 só é elegível se ocorreu depois de `effectiveFrom` e depois do `activatedAt` da rule, e antes de eventual `effectiveUntil`, `supersededAt` ou `revokedAt`.

## 5. Eventos comerciais qualificados

Uma rule pode escolher somente eventos CN7 de ocorrência única por sessão:

- `DELIVERY_RESOLVED`;
- `CONTENT_OPENED`;
- `CONTENT_COMPLETED`.

`CONTENT_PROGRESS` não é base comercial em CN8 porque pode ocorrer múltiplas vezes e não deve produzir accrual repetido por progress updates. `CONTENT_DISMISSED` também não gera remuneração.

O accrual preserva `usageObservationSource`, portanto `CONTENT_COMPLETED` continua explicitamente `CLIENT_REPORTED`; CN8 nunca o promove a fato server-verified.

## 6. Modos de compensação

### FIXED_PER_EVENT

A rule define `fixedAmountMinor` positivo. O accrual é exatamente esse valor e rejeita qualquer base de receita externa.

### REVENUE_SHARE_BPS

A rule define `revenueShareBps` entre 1 e 10.000. O endpoint de accrual exige explicitamente:

- `eligibleRevenueMinor`;
- `revenueSourceType`;
- `revenueSourceId`;
- `revenueEvidenceSha256`.

O valor é calculado deterministicamente por:

`floor(eligibleRevenueMinor × revenueShareBps / 10000)`.

A base monetária não é inferida automaticamente de Charge, Subscription, FinancialTransaction ou AggregatorSettlement. Sem proveniência completa, o accrual falha fechado.

## 7. Accrual

O accrual só nasce de `MANAGED_CONTENT` CN7 com Attribution Snapshot.

Antes da criação, CN8 exige:

- usage event existente;
- usage session gerenciada;
- content e content version coerentes com o snapshot;
- agreement referente ao mesmo content;
- Rights Holder do snapshot igual ao beneficiário do agreement;
- para escopo TENANT, consumo pertencente ao mesmo tenant;
- rule historicamente aplicável e com `qualifyingEventType` igual ao evento.

A unicidade física `(ruleVersionId, usageEventId)` impede dupla remuneração pelo mesmo fato na mesma regra. Replay exato é idempotente; replay com base monetária divergente falha.

Accruals são append-only e não podem ser atualizados ou apagados.

## 8. Settlement

O settlement consolida somente accruals:

- positivos;
- do mesmo escopo;
- do mesmo beneficiário;
- da mesma moeda;
- dentro de `[periodStart, periodEnd)`;
- ainda não vinculados a outro settlement.

Cada accrual pode aparecer em apenas um `CreatorSettlementItem`, protegido por unique constraint.

O request exige `settlementKey` UUID; replay exato retorna o mesmo lote e reutilização divergente falha.

O lote nasce `FINALIZED`: seus accruals, período e total já são imutáveis.

## 9. SETTLED é atestação, não execução de pagamento

CN8 não chama banco, PIX, gateway ou provider financeiro.

A transição `FINALIZED → SETTLED` exige:

- `settlementProvider`;
- `externalSettlementId`;
- `settlementEvidenceSha256`;
- `settledAt` real, nunca futuro.

Essa transição significa: **um operador autorizado atestou, com evidência externa, que o lote foi liquidado fora deste módulo**.

O AuditLog registra explicitamente `paymentExecutionByIron: false`.

A mesma referência externa provider + settlement ID não pode ser usada em dois lotes.

`SETTLED` é terminal.

## 10. Scope e autoridade

GLOBAL:

- somente `SUPER_ADMIN`;
- `gymId = null`.

TENANT:

- `OWNER` ou `MANAGER` com `activeGymId`;
- `SUPER_ADMIN` global não usa a rota TENANT como impersonation;
- nenhum DTO aceita `gymId` como autoridade.

Uma rule GLOBAL pode remunerar uso de conteúdo global observado em qualquer tenant; por isso o accrual preserva separadamente `consumptionGymId`.

## 11. Concorrência, auditoria e integridade física

Mutations CN8 usam `Serializable` com retry conhecido para `P2034/P2002`.

O PostgreSQL reforça:

- scope GLOBAL/TENANT;
- moeda ISO de três letras;
- hashes SHA-256;
- shape FIXED versus REVENUE_SHARE;
- validade temporal;
- um DRAFT e um ACTIVE por agreement;
- accrual único por rule/event;
- settlement key idempotente por escopo;
- um settlement item por accrual;
- referência externa de liquidação não reutilizável;
- rules com termos imutáveis;
- agreements, accruals e settlement items append-only;
- settlement final facts imutáveis e `SETTLED` terminal.

Agreement, rule lifecycle, accrual, finalização e atestação de settlement geram AuditLog no mesmo transaction boundary.

## 12. Fronteira CN9

CN8 não cria dashboard, ranking, KPI, forecast, recomendação, IA ou analytics operacional.

Essas responsabilidades permanecem bloqueadas para **IRON-CN9 — Operational Console + Analytics + Full Creator Network Certification**.
