# IRON-EQ4 — Equipment Capability + Exercise Mapping

## Objetivo

Conectar o conhecimento canônico de equipamentos do IRON aos exercícios sem transformar marca/modelo em regra de treino e sem confiar em inventário de outra academia. A camada EQ4 responde a duas perguntas distintas:

1. quais capacidades canônicas podem executar um exercício;
2. dentre essas capacidades, quais equipamentos estão realmente ativos no tenant atual.

## Fonte canônica

O arquivo `data/equipment/exercise-equipment-capability-map.v1.tsv` é o registro versionado inicial de exercício → capacidade. Cada linha contém:

- `exercise_name`: nome único do `Exercise` atual;
- `catalog_slug`: slug global de `EquipmentCatalogItem`;
- `compatibility`: `PRIMARY`, `ALTERNATIVE` ou `OPTIONAL`;
- `priority`: ordenação determinística das opções.

A sincronização `node scripts/sync-exercise-equipment-mappings.mjs` resolve nomes de exercício e slugs contra o banco e falha antes de qualquer mutação se algum alvo não existir. A projeção persistente é gravada em `EquipmentCatalogItem.metadata.exerciseMappings`, preservando outros metadados do item e registrando `exerciseMappingVersion`.

## Por que metadata e não nova tabela no EQ4

O EQ1 já criou `metadata Json?` exatamente como extensão governada do catálogo global. EQ4 usa essa extensão para uma relação pequena, versionada e controlada sem introduzir uma migration adicional ou alterar o schema relacional. O registry TSV permanece a fonte auditável; metadata é a projeção runtime. Se volume, cardinalidade ou necessidades analíticas futuras justificarem uma tabela dedicada, isso deverá ser uma evolução governada posterior, não uma mudança oportunista dentro deste bloco.

## Consulta tenant-scoped

`GET /equipments/exercises/:exerciseId/compatible`

- exige autenticação/RBAC já existentes;
- deriva o tenant pelo resolver canônico;
- considera apenas `Equipment.active = true` do tenant;
- exige vínculo com `EquipmentCatalogItem`;
- retorna apenas itens cujo metadata contém mapping do exercício;
- ordena por prioridade do mapping e nome.

Assim, Gym A nunca recebe uma máquina simplesmente porque Gym B a selecionou.

## Validação na criação de treino

Quando um `WorkoutExercise` informa `equipmentId`:

- o equipamento continua obrigado a pertencer ao tenant e estar ativo;
- se ele possui `catalogItemId`, a capacidade canônica precisa estar ativa;
- se o exercício possui ao menos um mapping canônico conhecido, um equipamento catalogado incompatível é rejeitado antes da criação do treino;
- equipamento legado sem `catalogItemId` continua compatível com o comportamento histórico até o fluxo de candidatos/governança do EQ5, evitando quebra silenciosa de dados existentes;
- exercício ainda sem mapping conhecido também mantém compatibilidade histórica, porque ausência de conhecimento não é tratada como evidência de incompatibilidade.

A regra é determinística: mapping conhecido restringe equipamento catalogado; ausência de mapping não inventa compatibilidade nem bloqueia silenciosamente o legado.

## Escopo semântico do mapping

O mapping EQ4 representa a **capacidade/estação principal compatível com a execução** e não uma lista completa de todos os acessórios físicos simultâneos. O modelo atual de `WorkoutExercise` possui um único `equipmentId`; portanto um exercício como supino livre pode exigir banco + barra + anilhas na prática, embora o vínculo operacional registre apenas a capacidade principal selecionada. O bloco não inventa uma estrutura multi-recurso sem decisão arquitetural futura.

## Registro inicial

O registry v1 cobre os três exercícios atualmente criados pelo seed legado (`Supino Reto`, `Remada Curvada`, `Agachamento Livre`) com alternativas canônicas existentes na taxonomia EQ0. A cobertura deve crescer junto do catálogo de exercícios, preservando versionamento e revisão humana.

## Migration

Nenhuma nova migration no EQ4. O bloco reutiliza `EquipmentCatalogItem.metadata` criado no EQ1.

## Fora de escopo

- intake/revisão de equipamento não encontrado: EQ5;
- Creator Registry, conteúdo e direitos: Fitness Creator Network;
- geração autônoma de treino por IA: IRON Intelligence;
- remodelagem de `WorkoutExercise` para múltiplos recursos simultâneos.
