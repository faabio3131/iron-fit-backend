# IRON — Configurable Commercial Capability Catalog

Status: **CANDIDATE**

## Regra comercial

Pacote, preco, limite, modulo e integracao nao podem depender de condicionais de plano ou cliente no codigo.

O codigo implementa capacidades tecnicas. O catalogo persistente governa quais capacidades podem compor planos e, posteriormente, add-ons.

## Autoridade

`ProductCapabilityDefinition` em PostgreSQL passa a ser a autoridade runtime para:

- chave da capability;
- tipo FEATURE / LIMIT / POLICY;
- dominio;
- descricao;
- valores permitidos de POLICY;
- estado ACTIVE / RETIRED.

A constante historica `PRODUCT_FEATURE_CATALOG_V1` permanece somente como registro/compatibilidade do baseline PE0 e nao deve ser consultada pelos services runtime.

## Bootstrap

A migration carrega como dados iniciais as capabilities ja certificadas, incluindo:

- referencia publica YouTube;
- conteudo IRON/tenant;
- catalogo/inventario de equipamentos;
- Wellhub/TotalPass;
- analytics;
- IA.

Esses registros nao definem pacote nem preco. O pacote de entrada podera habilitar `content.external_youtube` e manter Creator/premium desabilitados exclusivamente por entitlements de dados.

## Imutabilidade semantica

Uma capability criada nao muda silenciosamente de FEATURE para LIMIT/POLICY nem altera seu contrato semantico. A API deste incremento permite criar e aposentar, nao reescrever.

RETIRED:
- nao pode entrar em novo plano ou em nova publicacao;
- continua resolvivel para contratos historicos ja publicados.

## Integridade fisica

ProductPlanEntitlement, TenantProductConfiguration e UserProductPreference possuem FK para o catalogo.

Nenhuma dessas camadas pode persistir uma featureKey inexistente.

## Precedencia preservada

IRON policy -> plan entitlement -> tenant configuration -> user preference.

Camada inferior nunca amplia autoridade superior.

## Proxima etapa

Apos certificar este catalogo persistente, implementar add-ons versionados e sua composicao comercial, sem alterar os contratos historicos dos planos.
