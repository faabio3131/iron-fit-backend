# IRON — AGG1 Canonical Aggregator Domain

Status: **CANDIDATE — aguardando gate final**

Baseline: `main @ 9d0f035c7c04bfb194aacb9746c9bb1cad287bc8`

## Objetivo

Criar a fundação persistente provider-neutral do Aggregator Hub, sem implementar comportamentos pertencentes a AGG2–AGG9.

A arquitetura continua obedecendo aos invariantes oficiais:

- contrato vigente representa a relação jurídica, mas não autoriza sozinho uma visita futura;
- elegibilidade atual é evidência separada da identidade/membership;
- `UNKNOWN` é estado próprio e nunca equivale a `ELIGIBLE`;
- autorização da visita é um registro independente do evento físico;
- evento de catraca é vinculado por `AggregatorAccessEventLink`;
- settlement permanece separado e reconciliável com autorização + acesso físico;
- provider é identificado por `providerCode` e capabilities, sem enums/modelos Wellhub, TotalPass ou ClassPass no Core;
- IA não participa desta fundação nem do caminho crítico de acesso.

## Entidades canônicas

`AggregatorProviderConnection` representa a configuração/capabilities de um provider em um tenant. A chave `(gymId, providerCode)` impede conexão duplicada do mesmo provider para a mesma academia na topologia atual.

`AggregatorMember` registra identidade externa dentro de uma conexão e permite vínculo opcional com `Student`, sem converter automaticamente visitante externo em mensalista. `(connectionId, externalMemberId)` é único.

`AggregatorMembership` mantém vínculo/plano/status e validade fornecidos pelo provider. Membership histórico não é autorização.

`AggregatorAgreement` cria a estrutura persistente de versão/status/hash/proveniência que AGG2 usará no Digital Agreement Vault. AGG1 não implementa assinatura, coleta ou revogação operacional.

`AggregatorEligibilityCheck` registra resultado `UNKNOWN | ELIGIBLE | INELIGIBLE`, momento de verificação, validade, escopo, status original e proveniência. O campo `verifiedAt` é obrigatório.

`AggregatorVisitAuthorization` representa a decisão de visita, separada de membership, agreement, eligibility e catraca. O external visit ID é idempotente dentro do membro quando existir.

`AggregatorAccessEventLink` liga exatamente uma autorização de visita a um `AccessEvent` físico, mantendo a separação entre decisão e presença real.

`AggregatorProvisionalDecision` e `AggregatorRevalidationAttempt` são estruturas de persistência necessárias ao domínio, mas a política/engine correspondente só será implementada em AGG6.

`AggregatorSettlement`, `AggregatorReconciliation` e `AggregatorRiskCase` fornecem a estrutura persistente para a conciliação financeira futura, mas os engines/ledger/regras operacionais só serão implementados em AGG7.

## Proveniência e idempotência

O domínio preserva IDs externos quando fornecidos, status original, timestamps e `provenance` JSON para evidência técnica. Unicidades físicas evitam duplicidade de provider connection, member, visit e settlement quando a identidade externa correspondente estiver disponível.

Campos externos opcionais permanecem opcionais porque AGG0 comprovou que nem todo provider expõe a mesma topologia/capability. A ausência de ID externo não deve ser convertida em dado inventado.

## Segurança multi-tenant

A raiz do domínio é `AggregatorProviderConnection.gymId -> Gym.id`. Todas as identidades externas pertencem a uma conexão tenant-scoped. Vínculo opcional com `Student` não concede autorização e serviços futuros deverão validar que qualquer associação local pertence ao mesmo tenant antes de persistir/alterar vínculo.

Nenhum segredo de provider foi adicionado ao domínio AGG1. Credenciais, rotação, webhook verification e adapters permanecem para os blocos de integração/homologação correspondentes, evitando armazenar material sensível sem implementação de proteção adequada.

## Migration

Migration explícita:

`prisma/migrations/20260904204800_canonical_aggregator_domain/migration.sql`

Ela cria apenas enums/tabelas/índices/FKs do domínio Aggregator. Não altera dados históricos e não cria adapters, endpoints ou regras automáticas de acesso.

## Fora do escopo deste bloco

- AGG2: assinatura e Digital Agreement Vault operacional;
- AGG3: Eligibility + Visit Authorization Engine;
- AGG4: Wellhub Adapter;
- AGG5: TotalPass Adapter + execução do Future Provider Contract;
- AGG6: Provisional Access + Revalidation Engine;
- AGG7: 3-Way Reconciliation + Settlement Ledger + Risk Engine;
- AGG8: Reception Console + Operations Dashboard;
- AGG9: Intelligence & Analytics.
