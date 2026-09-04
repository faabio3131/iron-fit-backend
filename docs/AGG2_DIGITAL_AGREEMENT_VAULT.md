# IRON — AGG2 Digital Agreement Vault

Status: **CANDIDATE — IRON-AGG2**

Baseline: `main @ 115005cee8bf883839dfee87d492c17e82474c47`

## Objetivo

Operacionalizar o `AggregatorAgreement` criado no AGG1 como cofre digital versionado, tenant-scoped, auditável e fail-closed, sem antecipar o Eligibility/Visit Authorization Engine do AGG3.

## Invariantes

- acordo nunca é autorização de visita por si só;
- `SIGNED` registra aceitação do documento exato identificado por SHA-256;
- assinatura exige evidência eletrônica também identificada por SHA-256;
- nenhuma operação confia em `gymId` vindo de body/query/param; tenant vem da identidade autenticada;
- membro/agreement de Gym B não pode ser lido, assinado, revogado ou alterado por Gym A;
- nova versão supersede de forma transacional a versão corrente e preserva histórico;
- versão já registrada com o mesmo hash é idempotente; mesma versão com hash diferente é conflito;
- acordo `SUPERSEDED` não pode voltar a ser acordo corrente por revogação/assinatura;
- revogação e assinatura são auditadas na mesma transação da mudança de estado;
- nenhuma credencial de provider, token, biometria, conteúdo bruto de assinatura ou segredo é armazenado pelo Vault;
- IA permanece fora deste fluxo determinístico.

## API operacional

Prefixo: `/api/v1/aggregator/agreements`

- `POST /` — registra uma nova versão `REQUIRED` para um membro do tenant; versões correntes anteriores viram `SUPERSEDED` atomicamente.
- `GET /member/:memberId/current` — retorna somente acordo corrente `REQUIRED | SIGNED` do membro dentro do tenant autenticado.
- `GET /member/:memberId/history` — histórico versionado tenant-scoped.
- `POST /:id/sign` — exige `accepted=true`, hash exato do documento, hash da evidência e método de aceitação permitido; torna `SIGNED`.
- `POST /:id/revoke` — OWNER/MANAGER/SUPER_ADMIN podem revogar acordo corrente com motivo explícito.

## Evidência e proveniência

O Vault registra apenas metadados necessários e minimizados:

- `documentHash`: SHA-256 do documento apresentado;
- `version`;
- origem, referência documental, locale e jurisdição quando fornecidos;
- hash da evidência de aceitação;
- método de aceitação;
- `signerMemberId` interno;
- timestamps server-side.

O conteúdo bruto do documento e a evidência bruta não são persistidos neste bloco. `documentRef` é apenas referência opaca para um armazenamento/document-management autorizado; AGG2 não cria bucket nem integração externa.

## Concorrência e idempotência

Registro, assinatura e revogação usam transação PostgreSQL `Serializable` com retry controlado para conflitos `P2034/P2002`. A unicidade `(memberId, version)` do AGG1 permanece a barreira física contra reuso conflitante da mesma versão.

## Auditoria

Eventos permanentes:

- `AGGREGATOR_AGREEMENT_REGISTERED`
- `AGGREGATOR_AGREEMENT_SIGNED`
- `AGGREGATOR_AGREEMENT_REVOKED`

A auditoria contém tenant, ator interno, entidade, ID e transição de estado, sem payload bruto de assinatura nem credenciais.

## Segurança multi-tenant

Todas as mutações primeiro resolvem `AggregatorMember -> AggregatorProviderConnection.gymId` dentro do tenant autenticado. Operações por `agreementId` também filtram pela cadeia `agreement.member.connection.gymId`. Falha de escopo retorna `NotFound`, sem revelar existência cross-tenant.

## Limite do bloco

AGG2 não:

- consulta provider externo;
- decide `ELIGIBLE/INELIGIBLE/UNKNOWN`;
- cria `AggregatorVisitAuthorization`;
- libera catraca;
- cria política provisional/revalidation;
- executa settlement/reconciliation;
- implementa Wellhub/TotalPass/ClassPass adapter.

Essas responsabilidades permanecem nos blocos AGG3+ da Ordem Mestre.
