# IRON — Macro D — Physical Provisioning Checkpoint

Status: **BLOCKED_EXTERNAL / IN_PROGRESS**

Atualizado em: 2026-09-28

## CURRENT interno

A engenharia de runtime foi incorporada na `main` pela PR #84.

- merge commit: `4de72e5567053e036329dd33e44ca8e777c964fd`
- CI pós-merge: run `36363706317` — SUCCESS
- smoke: 522/522 PASS
- E2E integrado: 5/5 PASS
- live system contract: PASS
- production container image: PASS

Isso certifica o contrato interno; não declara ambiente físico homologado.

## Tentativa de provisionamento físico

A conta Railway conectada possuía um projeto existente de outro produto. Ele foi preservado sem qualquer mutação.

Foi criado um projeto privado separado:

- **IRON FIT**
- finalidade: ambiente físico do IRON, segregado de outros produtos

Para cumprir o Gate D com isolamento forte, a execução tentou criar projetos físicos separados para DEV e HOMOLOG, mantendo o projeto IRON FIT como PROD.

A Railway recusou novo provisionamento com o erro:

> Free plan resource provision limit exceeded. Please upgrade to provision more resources!

Nenhum serviço, database, domínio, secret ou deploy do IRON foi criado após esse bloqueio.

## Classificação correta

O Cronograma Mestre determina que dependência externa indisponível deve permanecer visível como `BLOCKED_EXTERNAL` e que trabalho independente deve continuar.

Portanto:

- D interno/runtime: **CERTIFIED_INTERNAL**
- D físico DEV/HOMOLOG/PROD: **BLOCKED_EXTERNAL**
- produção: **NÃO DECLARADA**
- E (banco físico CURRENT + DR): **não pode fechar antes de D físico**
- F (Web/API/DNS/TLS): **não pode fechar antes de D+E**

## Evidência necessária para desbloquear D

Para fechar D ainda será obrigatório comprovar, por ambiente:

- DEV físico acessível;
- HOMOLOG físico acessível;
- PROD físico acessível;
- backend e Web correspondentes;
- banco segregado;
- configuração segregada;
- `IRON_RUNTIME_ENV` correto;
- build SHA identificável;
- health/readiness verdes;
- observabilidade operacional;
- secrets globais fora do repositório;
- no PROD, Vault backend OCI conforme contrato de runtime.

## Próxima ação externa

Liberar capacidade de provisionamento suficiente na Railway **ou** aprovar formalmente outro runtime cloud compatível com a arquitetura única.

Nenhuma migração de provider será inferida automaticamente.
