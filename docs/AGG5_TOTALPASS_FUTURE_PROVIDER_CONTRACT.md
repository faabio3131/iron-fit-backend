# IRON — AGG5 TotalPass Adapter + Future Provider Contract

Status: **CANDIDATE — IRON-AGG5**

Baseline canônica: `main @ beb3fbe7b593c9f822ef9497d1dc50a43d2c1dfc`

## Escopo

AGG5 cria o contrato provider-neutral reutilizável e a fronteira específica TotalPass sobre o Core canônico já aprovado em AGG1–AGG4. O bloco não antecipa acesso provisório, revalidação, settlement/reconciliation, console operacional ou IA.

## Invariantes

- tenant ativo é obrigatório e deriva do contexto autenticado;
- member precisa pertencer ao tenant e ao provider `TOTALPASS` antes de qualquer chamada externa;
- decisão já existente por `(memberId, externalVisitId)` é devolvida antes de consumir transporte novamente;
- conexão não-`ACTIVE` nunca gera autorização por atalho;
- ausência de homologação, transporte ou resposta confiável produz evidência `UNKNOWN` e segue para decisão determinística do AGG3;
- `UNKNOWN` nunca equivale a `ELIGIBLE`;
- evidência `ELIGIBLE` sem validade oficial não recebe TTL inventado e é rebaixada para `UNKNOWN`;
- timestamp externo futuro inválido falha fechado;
- payload bruto, credenciais e segredos de provider não são persistidos no adapter;
- adapter fornece evidência; o AGG3 continua soberano sobre autorização de visita;
- nenhuma escrita em `AccessEvent`, acesso provisório ou settlement pertence ao AGG5.

## Future Provider Contract

O contrato comum classifica explicitamente todas as capabilities canônicas como `PUBLICLY_CONFIRMED`, `PARTNER_ACCESS_REQUIRED`, `NOT_PUBLICLY_CONFIRMED` ou `NOT_APPLICABLE`. Um provider futuro não pode omitir classificação nem declarar capability implícita.

A interface de transporte de elegibilidade trabalha somente com tipos canônicos (`externalLocationId`, `externalMemberId`, timestamps, status canônico, IDs externos e referência de evidência), mantendo URLs, autenticação e semântica privada fora do Core.

## TotalPass

A classificação usada neste bloco vem do discovery AGG0. Capacidades públicas de check-in/booking/settlement visibility permanecem registradas como confirmadas em nível de produto, enquanto detalhes privados de webhook signing, replay/idempotency, rate limit, localização/plan scope e contrato técnico final permanecem dependentes da homologação do parceiro.

O transporte real `TOTALPASS_PARTNER_TRANSPORT` é apenas uma porta injetável. Este bloco não hardcodeia endpoint, `partner_api_key`, `place_api_key`, token, webhook secret ou mecanismo de autenticação.

## Pendências externas legítimas para go-live

Antes de ativação live devem ser obtidos e homologados os documentos/credenciais vigentes da TotalPass aplicáveis ao tenant/unidade: contrato técnico final, credenciais de parceiro/unidade, semântica de webhook/eventos, política de replay/idempotência, rate limits, retries e processo oficial de homologação. Até isso ocorrer, o adapter falha fechado.

## Critério de saída

- contrato provider-neutral compilando e testado;
- adapter TotalPass tenant-scoped e fail-closed;
- testes adversariais permanentes;
- npm audit high, Prisma generate, lint/typecheck, build e regressão completos verdes;
- diff restrito ao AGG5;
- integração live explicitamente tratada como pendência externa, nunca como concluída.
