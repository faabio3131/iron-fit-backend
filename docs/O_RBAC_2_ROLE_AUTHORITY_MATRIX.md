# O-RBAC-2 — Matriz de Perfis e Autoridade Comercial

Data da auditoria: 2026-09-30  
Escopo: IRON FIT CORE V1 / Web comercial + APIs canônicas

## Princípio

A UI nunca amplia autoridade do backend. Toda superfície deve respeitar role + tenant + entitlement e, quando aplicável, step-up.

## Matriz por módulo

| Módulo / ação | SUPER_ADMIN | OWNER | MANAGER | RECEPTION | TRAINER | STUDENT |
|---|---|---|---|---|---|---|
| Cockpit operacional | Sim | Sim | Sim | Sim | Não | Mobile/self |
| Cockpit financeiro | Sim + step-up | Sim + step-up | Não | Não | Não | Não |
| Alunos — listar/detalhar | Sim | Sim | Sim | Sim | Sim | Self |
| Alunos — cadastrar | Sim | Sim | Sim | Sim | Não | Não |
| Consentimentos do aluno | Sim | Sim | Sim | Sim | Não | Self conforme domínio |
| Equipe — listar | Sim | Sim | Sim | Não | Não | Não |
| Equipe — criar vínculo | Sim | Sim | Sim | Não | Não | Não |
| Atribuir OWNER | Sim global | Não | Não | Não | Não | Não |
| Atribuir MANAGER | Sim | Sim | Não | Não | Não | Não |
| Atribuir RECEPTION/TRAINER | Sim | Sim | Sim | Não | Não | Não |
| Equipamentos — consultar | Sim | Sim | Sim | Sim | Sim | Não |
| Inventário — selecionar catálogo | Sim | Sim | Sim | Não | Não | Não |
| Equipment candidate intake | Sim | Sim | Sim | Não | Sim | Não |
| Equipment governance | Sim | Não | Não | Não | Não | Não |
| Exercícios — consultar | Sim | Sim | Sim | Sim | Sim | Não |
| Exercícios — criar | Sim | Sim | Sim | Não | Sim | Não |
| Avaliações — consultar | Sim | Sim | Sim | Sim | Sim | Self/mobile |
| Avaliações — registrar | Sim | Sim | Sim | Não | Sim | Não |
| Treinos — operar/revisar | Sim | Sim | Sim | Não | Sim | Self read/mobile |
| Agenda — consultar slots | Sim | Sim | Sim | Sim | Sim | Self/mobile |
| Agenda — criar slot | Sim | Sim | Sim | Não | Não | Não |
| Agenda — agendar/check-in | Sim | Sim | Sim | Sim | Não | Self conforme domínio |
| Acessos — histórico | Sim | Sim | Sim | Sim | Não | Self conforme domínio |
| Acessos — emitir credencial | Sim | Sim | Sim | Sim | Não | Não |
| Device token | Sim | Sim | Sim | Não | Não | Não |
| Financeiro academia | Sim + step-up | Sim + step-up | Não | Não | Não | Self charges/mobile |
| Billing IRON | Sim + step-up | Sim + step-up | Não | Não | Não | Não |
| Configuração de entitlement | Sim + step-up | Sim + step-up | Não | Não | Não | Não |
| Integrações | Sim + step-up | Sim + step-up | Não | Não | Não | Não |
| Segurança da própria conta | Sim | Sim | Sim | Sim | Sim | Sim |

## Hierarquia de delegação

- SUPER_ADMIN global pode atribuir SUPER_ADMIN apenas sem tenant binding.
- OWNER não pode criar/delegar outro OWNER.
- OWNER pode atribuir MANAGER, RECEPTION e TRAINER no tenant ativo.
- MANAGER não pode criar/delegar MANAGER nem OWNER.
- MANAGER pode atribuir apenas RECEPTION/TRAINER no fluxo Equipe.
- RECEPTION, TRAINER e STUDENT não atribuem roles.
- Nenhum ator não-global pode vincular usuário em tenant diferente do tenant ativo.

## Superfícies administrativas restritas

Exigem OWNER/SUPER_ADMIN e step-up ativo:

- Financeiro da academia;
- Assinatura IRON;
- configurações administrativas de plano/entitlements;
- Integration Center.

O step-up é vinculado à sessão atual e possui expiração.

## Regras de regressão

- Toda mudança em roles de controller deve atualizar testes de metadata/RBAC.
- Toda mudança de navegação Web deve atualizar testes de visibilidade por perfil.
- Operações negadas no frontend devem permanecer negadas também por API direta.
- O frontend não pode oferecer role que o ator autenticado não pode atribuir.
