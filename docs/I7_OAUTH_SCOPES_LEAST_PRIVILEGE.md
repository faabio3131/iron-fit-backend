# IRON — Macro I7 — OAuth Scopes & Least Privilege

Status: **CANDIDATE — engenharia interna implementada; aguardando CI/PR/merge. Revisão física dos scopes reais permanece vinculada aos apps Meta/Google e ao C Gate.**

## Autoridade

I7 permanece dentro da arquitetura existente de `IntegrationConnection + Vault + IntegrationProviderRegistry`.

Nenhuma autoridade paralela de scopes é criada.

A configuração GLOBAL do OAuth App continua definindo `capabilityScopes`, mas o runtime agora aplica guardrails adicionais para impedir ampliação implícita de permissões.

## Política de least privilege

O início do OAuth:

- nunca aceita um parâmetro `scope` livre do tenant;
- deriva scopes exclusivamente de `capabilityScopes` do OAuth App GLOBAL;
- exige seleção explícita de capability quando o provider oferece mais de uma capability;
- não assume automaticamente todas as capabilities de um provider multi-capability;
- solicita somente a união dos scopes das capabilities explicitamente selecionadas;
- persiste no authorization attempt exatamente as capabilities/scopes efetivos usados;
- retorna os scopes efetivos como metadata não secreta para inspeção/revisão;
- rejeita scope token inválido, vazio, com whitespace ou fora da forma OAuth segura;
- limita cardinalidade por capability e do conjunto final para impedir configuração excessiva acidental;
- mantém `scope` entre os parâmetros reservados, impedindo sobrescrita por `authorizationParams`.

## Meta

O provider Meta possui múltiplas capabilities:

- `meta.facebook`;
- `meta.instagram`;
- `meta.whatsapp`.

Por I7, uma autorização Meta sem `capabilities[]` explícitas falha fechada.

Exemplo: se somente `meta.whatsapp` estiver habilitado para o recurso, o runtime solicita somente os scopes governados para `meta.whatsapp`; scopes de Facebook/Instagram não entram por default.

## Google

O provider Google possui atualmente uma capability registrada: `google.oauth`.

Enquanto houver uma única capability, a seleção implícita dessa capability continua permitida; se o registry evoluir para múltiplas capabilities, a regra de seleção explícita passa a valer automaticamente.

## Revisão e evidência

A evidência interna certificável de I7 cobre:

- seleção explícita em providers multi-capability;
- isolamento da união de scopes pela capability selecionada;
- rejeição de scope token inválido;
- ausência de `scope` arbitrário vindo da request;
- persistência do conjunto efetivo no attempt;
- regressão completa do OAuth Core.

A revisão **dos nomes reais de scopes concedidos pelos providers** não deve ser inventada nem inferida sem apps reais e documentação/provider CURRENT.

Antes de homologação física, cada OAuth App em HOMOLOG deve comprovar:

1. capability habilitada;
2. scopes reais configurados no `capabilityScopes`;
3. necessidade de cada scope para o recurso;
4. consent screen/provider approval correspondente;
5. ausência de permissões excedentes;
6. fluxo real de authorization, callback, refresh/revoke quando aplicável.

## Gate

I7 interno pode ser certificado por CI/PR/merge.

O Macro I completo e a homologação física Meta/Google continuam dependentes do C Gate, credenciais/apps reais, redirects oficiais e execução reproduzível em HOMOLOG.
