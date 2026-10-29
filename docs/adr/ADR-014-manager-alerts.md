# ADR-014 — Centro canônico de alertas do gestor

Status: accepted — 2026-10-29

## Contexto

O IRON já possui comunicação academia→aluno e adapters de WhatsApp Meta/Evolution. Esses registros não representam uma caixa operacional de gestores: consentimento, destinatário, ciclo de vida, autoridade, retenção e confirmação são diferentes.

## Decisão

Criar `ManagerAlert` como fonte de verdade tenant-scoped. `ManagerAlertRecipient` materializa destinatários derivados exclusivamente de memberships ativas. `ManagerAlertPreference` governa canais individuais e `ManagerAlertDelivery` registra tentativas externas. Evolution, Meta, e-mail e push são adapters; a indisponibilidade deles nunca remove o alerta interno.

As categorias `STUDENT_BILLING` e `SECURITY` são inicialmente restritas a `OWNER`. As demais alcançam `OWNER` e `MANAGER`. O serviço de ingestão usa chave única `(gymId, deduplicationKey)` e devolve o registro existente em replay.

## Threat model resumido

| Ameaça | Controle |
|---|---|
| leitura ou mutação cross-tenant | `gymId` da sessão + destinatário materializado em toda consulta/mutação |
| papel inventado pelo cliente | destinatários derivados de `UserRole`/`Role`, nunca do payload HTTP |
| duplicação por retry/concorrência | unique tenant-scoped + tratamento de `P2002` |
| duas transições concorrentes | `updateMany` condicionado ao status observado |
| vazamento de segredo/dado sensível | payload mínimo; adapters usam Vault; auditoria sanitiza chaves sensíveis |
| falso envio | estado por entrega; `SENT` somente após confirmação do adapter |
| canal externo indisponível | inbox `IN_APP` independente e persistente |

## Consequências

- O módulo de comunicação com alunos permanece intacto.
- Produtores de domínio chamam `ManagerAlertsService.ingest`; não escrevem tabelas diretamente.
- Canais externos e suas homologações podem evoluir sem alterar o contrato da inbox.

## Control-plane Evolution

A Evolution é uma infraestrutura central da FM: uma `IntegrationConnection` global guarda somente a referência do segredo no Vault e a configuração pública (`baseUrl`, `webhookUrl`). Cada academia recebe um `EvolutionTenantInstance` com nome determinístico e único. O tenant pode solicitar QR/status, mas nunca recebe a API key. Provisionamento, conexão, estado e logout seguem os endpoints v2 oficiais `/instance/create`, `/instance/connect/{instance}`, `/instance/connectionState/{instance}` e `/instance/logout/{instance}`. O webhook usa header autenticado, `base64=false` e atualiza somente a instância vinculada.
