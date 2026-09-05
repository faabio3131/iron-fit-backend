# IRON-EQ5 — Catalog Governance, Candidate Intake + Full Certification

## Objetivo

Fechar a Fase C — IRON Equipment Knowledge & Inventory com governança explícita do Catálogo Mestre, fluxo persistente para equipamentos não encontrados e certificação dos invariantes EQ0–EQ5.

O princípio central permanece: `EquipmentCatalogItem` é conhecimento global governado pelo IRON; `Equipment` é inventário de uma academia. Um tenant pode selecionar conhecimento global existente ou sugerir um candidato, mas não pode promover silenciosamente sua descrição local a verdade global.

## Encerramento do cadastro manual para novos itens

O endpoint legado `POST /equipments` permanece somente como superfície compatível para clientes antigos, mas novas criações manuais são recusadas. Os registros legados já existentes continuam legíveis e não são apagados ou migrados automaticamente.

Para novos equipamentos existem apenas dois caminhos canônicos:

1. item já existe no Catálogo Mestre → selecionar por `POST /equipments/catalog/selection`;
2. item não existe → submeter candidato por `POST /equipments/catalog/candidates`.

Assim o EQ5 encerra a criação de novos `Equipment` sem vínculo canônico sem destruir o histórico anterior.

## Candidate Intake tenant-scoped

`POST /equipments/catalog/candidates`

- roles permitidas: `SUPER_ADMIN`, `OWNER`, `MANAGER`, `TRAINER`;
- `gymId` nunca vem do body; o tenant é resolvido pelo contexto autenticado;
- SUPER_ADMIN global precisa escolher explicitamente o tenant;
- nome, categoria sugerida, fabricante/modelo, aliases e evidência são sugestões, não autoridade canônica;
- candidato usa fingerprint SHA-256 determinístico, com unicidade `(gymId, fingerprint)`, tornando reenvio idempotente por academia;
- se nome/slug já corresponder a item ativo do catálogo, a submissão é recusada e a academia deve usar seleção;
- criação do candidato e `AuditLog` ocorrem na mesma transação `Serializable`.

`GET /equipments/catalog/candidates` lista somente os candidatos do tenant resolvido.

## Governança global

As rotas de governança são exclusivas de `SUPER_ADMIN`:

- `GET /equipments/catalog/governance/candidates`;
- `POST /equipments/catalog/governance/candidates/:candidateId/review`.

Decisões possíveis:

### APPROVE

Cria um novo `EquipmentCatalogItem` global somente após revisão humana. Nome, slug e categoria podem ser corrigidos na revisão. O novo item guarda proveniência `EQ5_CANDIDATE_APPROVAL` no metadata, o candidato aponta para o item criado e ambos os fatos são auditados atomicamente.

Se já existir item com mesmo slug ou nome, APPROVE falha e a decisão correta é `MERGE`.

### MERGE

Resolve o candidato para um `EquipmentCatalogItem` ativo já existente. Não cria novo item global e preserva o histórico do candidato.

### REJECT

Encerra o candidato sem criar item global. Rejeição exige justificativa de revisão.

Uma decisão finalizada é imutável pelo endpoint de revisão: nova chamada devolve o estado já decidido e não reexecuta a mutação.

## Inventário após aprovação

APPROVE ou MERGE **não seleciona automaticamente** o equipamento para a academia. O conhecimento global e a posse local permanecem fatos separados. A academia deve utilizar o fluxo EQ3 de seleção do catálogo, preservando a fronteira global/tenant.

## Integridade e migration

Migration explícita:

`20260905044200_equipment_catalog_candidate_governance`

Ela adiciona:

- enum `EquipmentCatalogCandidateStatus`;
- tabela `EquipmentCatalogCandidate`;
- unicidade `(gymId, fingerprint)`;
- índices para fila de governança e consulta tenant-scoped;
- referências a `Gym`, usuários de submissão/revisão e item canônico resolvido.

A alteração é aditiva. Nenhum `Equipment`, `WorkoutExercise` ou item histórico do catálogo é removido.

## Auditoria

Ações permanentes:

- `EQUIPMENT_CATALOG_CANDIDATE_SUBMITTED`;
- `EQUIPMENT_CATALOG_CANDIDATE_APPROVED`;
- `EQUIPMENT_CATALOG_CANDIDATE_MERGED`;
- `EQUIPMENT_CATALOG_CANDIDATE_REJECTED`;
- `EQUIPMENT_CATALOG_ITEM_CREATED_FROM_CANDIDATE`.

O AuditLog registra ator, tenant, entidade, IDs e transição de estado, sem promover notas livres ou credenciais a informação de autorização.

## Certificação EQ0–EQ5

O fechamento da Fase C exige simultaneamente:

- taxonomia global EQ0 preservada;
- domínio canônico e migration EQ1 íntegros;
- fabricante/modelo/alias/equivalência EQ2 preservados;
- seleção de inventário tenant-scoped EQ3 preservada;
- mapping exercício-capacidade EQ4 preservado;
- candidate intake/governança EQ5 ativo;
- nenhuma criação silenciosa de item global por tenant;
- Gym A nunca lê ou altera candidatos/inventário de Gym B por rotas tenant-scoped;
- somente SUPER_ADMIN revisa candidatos globais;
- APPROVE/MERGE/REJECT são auditáveis e determinísticos;
- lint/typecheck, build, npm audit e regressão completa verdes, sem teste crítico skipped.

Somente após esta certificação a Fase D — Fitness Creator Network pode ser liberada.

## Fora de escopo

- Creator Registry, direitos e settlements de conteúdo;
- geração de treino por IA;
- homologação automática de fabricante/modelo por LLM;
- deleção automática de legado sem `catalogItemId`;
- seleção automática de inventário após aprovação de candidato.
