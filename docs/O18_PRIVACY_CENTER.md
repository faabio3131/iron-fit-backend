# O18 — Privacy Center

Status: **CANDIDATE**

O Privacy Center reutiliza o domínio canônico já existente de LGPD/legal. Nenhum texto jurídico, prazo legal, base legal ou aprovação é inventado pela interface.

## Self-service autenticado

Endpoints existentes preservados:

- `POST /privacy/dsr`;
- `GET /privacy/dsr`;
- `POST /privacy/dsr/cancel`;
- `GET /privacy/legal-documents`;
- `POST /privacy/legal-acceptances`;
- `GET /privacy/legal-acceptances`.

O18 adiciona:

- `GET /privacy/consents`;
- `PATCH /privacy/consents`.

Esses endpoints derivam autoridade exclusivamente de `user.id`. Nenhum `studentId`, `gymId` ou tenant informado pelo cliente participa da seleção do registro.

Quando o usuário autenticado não possui perfil `Student`, o read model retorna `available=false`; isso permite que OWNER, MANAGER e outros perfis utilizem DSR/documentos/aceites sem receber autoridade de consentimento de aluno.

## Consentimentos

O titular com perfil Student pode alterar somente os próprios campos:

- saúde;
- comunicação;
- biometria.

A alteração é auditada com before/after e mantém o `gymId` canônico do próprio Student.

## Operações sensíveis

Permanecem exclusivas de `SUPER_ADMIN`:

- fila operacional de DSR;
- revisão de DSR;
- snapshot de governança.

A interface não deve inventar SLA legal nem permitir aprovação de documento jurídico.

## Autoridade jurídica preservada

Somente documentos `APPROVED`, aprovados e já efetivos são expostos para aceite. O aceite permanece vinculado à versão/hash canônicos do documento.
