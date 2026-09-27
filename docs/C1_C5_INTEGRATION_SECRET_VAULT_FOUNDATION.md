# IRON — Commercial Readiness C1-C5 — Integration & Secret Vault Foundation

Status: **CANDIDATE INTERNO — C1-C5**

## Decisão

O IRON adota uma autoridade transversal de integrações. Novo cliente configura uma conexão; não cria branch, commit, deploy ou variável de ambiente exclusiva.

A separação é obrigatória:

- `GLOBAL`: credencial pertencente à FM/plataforma;
- `TENANT`: credencial pertencente à academia;
- `DEV | HOMOLOG | PROD`: ambientes segregados.

## C1 — Provider Registry

`IntegrationProviderRegistry` registra adapters por `providerCode`, capabilities, auth model, ambientes e chaves públicas/secretas permitidas. O domínio de integração não importa SDK de Mercado Pago, PagBank, Meta, Google ou outro fornecedor.

Adicionar um provider real exige um adapter homologado e registro explícito; adicionar um **cliente** nunca exige código.

## C2 — Connection Authority

`IntegrationConnection` é a autoridade persistente de uma conexão. O banco impõe:

- GLOBAL => `gymId IS NULL`;
- TENANT => `gymId IS NOT NULL`;
- unicidade de provider/ambiente por escopo;
- providerCode canônico;
- configuração pública separada de segredo.

## C3 — Secret Reference

`IntegrationSecretVersion.referenceId` é uma referência opaca. Não existe coluna Prisma para API key, access token, refresh token, webhook secret, private key ou ciphertext de credencial de provider.

O caminho físico do cofre é derivado server-side de ambiente, escopo, tenant, connection e referência. Esse caminho não é API pública.

## C4 — Vault Backend

O adapter inicial usa o protocolo OpenBao KV v2 atrás do contrato `IntegrationVaultPort`.

Motivos:

- backend real de secret management, não mock de aplicação;
- versionamento do KV v2;
- ACLs/policies no backend;
- remoção permanente via metadata delete quando o ciclo exigir destruição;
- integração por HTTP estreito, sem espalhar vendor SDK no domínio.

O CI usa **OpenBao 2.7.0 em dev mode exclusivamente para certificação**, com storage efêmero. Dev mode nunca é produção.

Produção continuará bloqueada até D provisionar um vault não-dev, persistente, com autenticação de workload e políticas mínimas. O root token de dev do CI não é credencial de produção.

Fora de ambiente local de teste, o adapter exige HTTPS.

## C5 — Secret Resolver

`IntegrationSecretResolverService`:

1. carrega a connection canônica;
2. exige igualdade de scope + gymId;
3. exige o mesmo `INTEGRATION_RUNTIME_ENV`;
4. recusa conexão REVOKED;
5. para runtime, exige connection ACTIVE;
6. recusa secret metadata ausente/revogada/expirada;
7. deriva o caminho internamente;
8. resolve no Vault;
9. atualiza somente metadata de uso/verificação.

Nenhum endpoint de usuário recebe o valor secreto nesta etapa.

## Boundary

C1-C5 não conectam Mercado Pago, PagBank, Meta, Google, Wellhub, TotalPass ou qualquer provider real. Esses adapters só podem usar o resolver depois dos gates subsequentes.

C6-C14 ainda precisam fechar write-only admin API/UX, step-up, lifecycle completo, redaction, environment policy, DR, adversarial matrix, secret scanning e break-glass antes do **Gate C** final.
