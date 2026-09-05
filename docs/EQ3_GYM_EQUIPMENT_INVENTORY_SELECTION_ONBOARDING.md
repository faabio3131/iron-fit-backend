# IRON-EQ3 — Gym Equipment Inventory + Selection/Onboarding

## Objetivo

Substituir o cadastro repetitivo de aparelhos como caminho principal por uma experiência de seleção sobre o Catálogo Mestre IRON. A academia consulta o catálogo global, pesquisa por nome/slug/alias, filtra por categoria e marca os equipamentos que realmente possui.

## Invariantes

- `EquipmentCatalogItem` continua global, sem `gymId` e governado pelo IRON.
- `Equipment` continua sendo inventário tenant-scoped da academia.
- Nenhuma seleção de academia cria silenciosamente um item global.
- Tenant é derivado do contexto autenticado; `SelectCatalogEquipmentDto` não aceita `gymId`.
- SUPER_ADMIN global continua obrigado a escolher explicitamente um tenant pelo mecanismo canônico já existente.
- Seleção é idempotente pela constraint `(gymId, catalogItemId)` e por `upsert`.
- Deseleção apenas desativa o inventário da academia; não remove nem altera o catálogo global e não apaga referências históricas.
- Mutações de seleção/deseleção são auditadas atomicamente.

## Fluxo operacional

1. Operação controlada sincroniza a taxonomia EQ0 para `EquipmentCatalogItem` com `node scripts/sync-equipment-catalog.mjs`.
2. `GET /equipments/catalog` retorna catálogo ativo com estado `selected` e `inventoryId` específicos da academia autenticada.
3. `POST /equipments/catalog/selection` recebe somente `catalogItemIds` e cria/reativa os itens correspondentes no inventário do tenant.
4. `DELETE /equipments/catalog/:catalogItemId/selection` desativa somente o item daquela academia.
5. `GET /equipments` e `GET /equipments/:id` passam a incluir a referência canônica `catalogItem` quando existente.

## Busca e onboarding

A consulta aceita `search`, `category` e `limit`. A busca é bounded e considera nome, slug e aliases do item canônico. O backend devolve o estado de seleção da academia, permitindo uma interface de onboarding por checkbox/cards sem exigir cadastro manual item a item.

## Compatibilidade

O endpoint legado de criação manual de `Equipment` é preservado por compatibilidade e para futura integração com o fluxo de candidatos do EQ5. Ele não cria `EquipmentCatalogItem` e, portanto, não viola a governança global do catálogo.

## Migration

Nenhuma nova migration no EQ3. O vínculo opcional `Equipment.catalogItemId` e a unicidade `(gymId, catalogItemId)` foram criados no EQ1.

## Fora de escopo

- fabricante/modelo como autoridade funcional: EQ2;
- capacidade ↔ exercício: EQ4;
- candidato de aparelho não encontrado, revisão e governança: EQ5;
- Creator Network;
- IRON Intelligence.
