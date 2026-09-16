# IRON-AI0 G2 — Persistence, Provenance & Configuration Profiles

## Escopo

G2 materializa somente fatos mínimos de governança: perfis versionados de configuração externa e trilhas de execução/proveniência. Não existe provider real, secret resolver, endpoint `/me/ai/*` ou decisão autônoma.

## Configuração externa

`AiConfigurationProfile` suporta escopo GLOBAL e TENANT. O banco impõe fisicamente que GLOBAL não possua gymId e TENANT possua gymId. Cada capability é versionada de forma monotônica e a camada de serviço só aceita a próxima versão esperada.

Novo CLIENTE continua sendo configuração, não código. `secretReference` guarda somente referência opaca. Não há coluna para API key, token ou segredo em texto puro.

Configurações são auditadas sem gravar o valor de `secretReference`; o AuditLog registra apenas se a referência está configurada.

## Proveniência

`AiExecutionTrace` registra tenant, ator/aluno quando aplicável, capability, provider/model, prompt/version, perfil/version de configuração, hashes SHA-256 de entrada/saída, confidence, flags, status, categoria de falha, latência, requestId e timestamp.

Não existem colunas para prompt bruto, request body, response body ou payload secreto. `requestId` é único e replay idêntico é idempotente; reutilização para outro fato falha fechada.

Quando uma execução referencia um perfil persistido, o serviço exige correspondência de scope, tenant, capability, provider, model e versão.

## Integridade física

A migration é aditiva e inclui FKs para Gym/User/Student, checks de scope, HTTPS, versão/timeout/budget, hashes SHA-256, confidence e latência, além de índices únicos parciais para versionamento GLOBAL e TENANT.

## Fora do escopo

- resolução de precedência em runtime (G4);
- resolução de segredo real (G4);
- provider/SDK externo (G4+);
- Context Builder/Policy/Output Validator (G3);
- endpoints mobile (G5);
- workout candidate (G6).
