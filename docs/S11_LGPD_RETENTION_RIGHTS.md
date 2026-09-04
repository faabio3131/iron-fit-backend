# S11 — LGPD: retenção e direitos do titular

Este documento define o baseline operacional do IRON Fit para tratamento de dados pessoais no bloco S11.

## Princípios

- minimização: coletar e manter somente os dados necessários ao propósito declarado;
- finalidade: saúde, comunicação e biometria possuem consentimentos independentes;
- rastreabilidade: mudanças relevantes devem gerar AuditLog com ator, tenant, ação, entidade e contexto anterior/posterior quando aplicável;
- segurança: segredos, credenciais, tokens, hashes sensíveis e dados equivalentes não devem ser gravados no AuditLog;
- revogação: consentimentos opcionais podem ser retirados e a nova decisão deve ser persistida e auditada.

## Direitos do titular

O produto deve suportar processo operacional para confirmação de tratamento, acesso, correção, portabilidade quando aplicável, informação sobre compartilhamento, revogação de consentimento, oposição e eliminação quando juridicamente cabível.

Solicitações de eliminação não autorizam remoção cega de dados sujeitos a obrigação legal, regulatória, prevenção a fraude, exercício regular de direitos ou outra base legal válida. Nesses casos o dado deve ser bloqueado/restrito ou retido pelo prazo aplicável e a justificativa registrada.

## Retenção

Os prazos concretos de retenção devem ser parametrizados por categoria de dado e obrigação aplicável antes do go-live comercial. Até essa definição, nenhuma rotina automática de exclusão definitiva deve ser ativada.

AuditLog é registro de governança e deve possuir política própria de retenção. Eventos de segurança, financeiros e de acesso podem exigir retenções diferentes de dados operacionais comuns.

## Consentimentos no Student

- `consentHealth`: tratamento opcional de dados de saúde além das bases legais independentes que venham a existir;
- `consentComm`: comunicações opcionais/promocionais;
- `consentBiometry`: uso de biometria quando aplicável.

Cada alteração deve ser tenant-scoped e gerar `STUDENT_CONSENTS_UPDATED` com valores anterior e posterior.

## Pendências para produção

Antes da certificação final S12/go-live: definir tabela formal de retenção por categoria, canal de atendimento ao titular, SLA interno, responsáveis, fluxo de verificação de identidade, rotina de exportação, rotina de anonimização/eliminação e evidências jurídicas das bases legais aplicáveis.
