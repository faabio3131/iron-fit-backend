# IRON — Macro I6 — Communication Dispatch Boundary

Status: **CANDIDATE — engenharia interna implementada; aguardando CI/PR/merge. Envio fisico Meta/WhatsApp permanece dependente do C Gate, conexao OAuth tenant real e configuracao oficial do provider.**

## Autoridade canonica

I6 evolui o dominio existente de comunicacao. Nao cria uma segunda fila.

A autoridade continua sendo `CommunicationMessage`:

`QUEUED -> SENDING -> SENT | FAILED`

O dispatch externo adiciona apenas metadados operacionais e de idempotencia:

- `dispatchKey` unico e duravel;
- `attemptCount`;
- `nextAttemptAt` / `lastAttemptAt`;
- lease persistente `dispatchLeaseOwner` + `dispatchLeaseUntil`;
- `providerCode`;
- `providerConnectionId` canonico;
- `providerMessageRef`;
- `lastErrorCode` sanitizado.

Nenhuma credencial do provider entra em `CommunicationMessage`.

## Tenant binding

Para WhatsApp, o worker resolve exclusivamente:

- `IntegrationConnection TENANT`;
- mesmo `gymId` da mensagem;
- mesmo ambiente runtime;
- provider `meta`;
- capability `meta.whatsapp`;
- status `ACTIVE`;
- secret nao revogado/expirado.

Se zero ou mais de uma conexao elegivel existir, o envio falha fechado. Nao existe fallback para outro tenant nem selecao por `gymId` vindo de payload externo.

A credencial e resolvida por `IntegrationSecretResolverService`, e o access credential e extraido do bundle OAuth do Vault somente no boundary de envio.

## Consentimento e preferencia

Antes do provider:

- `Student.consentComm` deve estar ativo;
- `CommunicationPreference.whatsappEnabled` deve estar ativo;
- telefone do usuario deve existir e ser normalizavel.

Falha em qualquer condicao impede a chamada externa.

## Worker e concorrencia

O worker:

- processa somente mensagens `WHATSAPP` no escopo de I6;
- adquire lease via CAS antes do envio;
- impede dois workers de enviarem simultaneamente a mesma mensagem;
- reutiliza o mesmo `dispatchKey` durante todo o lifecycle;
- faz ate 5 tentativas com backoff governado;
- grava somente codigos de falha sanitizados;
- registra resultado sanitizado em AuditLog;
- nao grava corpo de resposta bruto, bearer token ou dados de autenticacao em log/audit.

Canais EMAIL/SMS/PUSH permanecem fora deste adapter I6 e seguem seus macroblocos/providers proprios.

## Adapter Meta/WhatsApp

O adapter recebe:

- recipient;
- body;
- endpoint HTTPS nao secreto da conexao tenant;
- access credential redigido vindo do Vault.

A chamada externa usa Bearer somente no boundary. O retorno persiste apenas a referencia da mensagem do provider quando disponivel.

O `dispatchKey` e a autoridade de idempotencia/correlacao interna do IRON. Este WP nao declara garantia de exactly-once do provider externo quando a API do provider nao oferece uma primitive equivalente.

## Limite do gate

Este WP certifica a engenharia interna do boundary.

Nao declarar Meta/WhatsApp fisicamente homologado antes de:

- C Gate real;
- Meta App real;
- conexao tenant real via Vault;
- endpoint/configuracao oficial do WhatsApp para a academia;
- envio real em HOMOLOG;
- evidencias de retry/provider outage e ausencia de cross-tenant dispatch.

I7 — Scopes & Least Privilege permanece o proximo WP do Macro I.
