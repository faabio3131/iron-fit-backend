# IRON — Commercial Readiness — C4A OCI Vault Adapter

Status: **CANDIDATE — aguardando CI/PR/merge/post-merge e provisionamento físico OCI separado**

## Objetivo

Implementar o adapter oficial OCI para o contrato provider-neutral `IntegrationSecretVaultPort`, sem alterar a autoridade multi-tenant C1-C3.

A documentação oficial da OCI confirma que:

- Secret Retrieval usa `GetSecretBundle` / `GetSecretBundleByName`;
- conteúdo manual é enviado em Base64;
- o limite máximo de um secret bundle é 25 KB;
- atualizar o conteúdo cria nova versão;
- `scheduleSecretDeletion` coloca o secret em pending deletion e o torna indisponível, com janela de exclusão de 1 a 30 dias.

## Autenticação

Modos suportados:

- `INSTANCE_PRINCIPAL` — preferencial quando o runtime estiver em OCI Compute;
- `RESOURCE_PRINCIPAL` — para serviços OCI compatíveis;
- `CONFIG_FILE` — somente desenvolvimento/homologação controlada; proibido quando `NODE_ENV=production`.

Nenhuma credencial OCI é criada por tenant.

## Configuração global do runtime

- `INTEGRATION_SECRET_VAULT_BACKEND=OCI`
- `OCI_VAULT_AUTH_MODE`
- `OCI_VAULT_COMPARTMENT_ID`
- `OCI_VAULT_ID`
- `OCI_VAULT_KEY_ID`
- `OCI_CONFIG_FILE` / `OCI_CONFIG_PROFILE` somente quando CONFIG_FILE for permitido.

Vault/key/compartment OCIDs são identificadores de infraestrutura, não credenciais de cliente.

## Mapeamento físico

A `secretReference` opaca `isv_...` é usada como `secretName` dentro do Vault do ambiente ativo.

Consequências:

- PostgreSQL não precisa armazenar OCID do segredo;
- não existe caminho contendo tenant/provider;
- não existe env por cliente;
- o resolver continua encontrando a conexão por tenant/ambiente antes de acessar o Vault.

## Operações

### create

Cria secret OCI com conteúdo Base64 e nome igual à referência opaca. Retry de create que encontre o mesmo conteúdo é idempotente; referência existente com conteúdo diferente falha.

### rotate

Lê a versão CURRENT e exige `expectedVersion`. Divergência falha antes de atualizar. A nova versão é promovida como CURRENT.

### get

Recupera somente CURRENT e devolve plaintext apenas dentro do boundary do `IntegrationSecretVaultPort`; o `IntegrationSecretValue` do C5 continua protegendo serialização/log.

### revoke

Agenda a exclusão física para aproximadamente 25 horas depois, respeitando a janela OCI. O fluxo C6/C8 deverá marcar a conexão como revogada no PostgreSQL antes da chamada física, produzindo fail-closed imediato mesmo antes da destruição definitiva.

## Limite desta entrega

C4A integra o código com o SDK oficial. Ainda não prova acesso a uma tenancy OCI real.

Para promover C4 como **PHYSICALLY CERTIFIED** ainda será obrigatório:

1. criar/selecionar Vault OCI real;
2. criar/selecionar master encryption key simétrica;
3. definir compartment;
4. aplicar IAM/dynamic-group/resource-principal policy de menor privilégio;
5. configurar DEV/HOMOLOG/PROD separadamente;
6. executar create → get → rotate → revoke contra HOMOLOG real;
7. provar que tenant A nunca resolve tenant B;
8. registrar IDs/evidência sem registrar qualquer valor secreto.
