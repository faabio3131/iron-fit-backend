# Auditoria de perfis e permissões — 29/09/2026

Pedido do usuário: separar acesso operacional de funcionários da administração e das informações financeiras; investigar botões inoperantes no app.

CURRENT: main dbce92b8c96ff8c22c2f1ac54084a70784a2a85f; correção isolada fix/staff-financial-permissions. Sem mudanças de schema, migrations ou credenciais.

## Achados e correções
- FinancialController autorizava cargos operacionais sem verificar financial:read/write. PermissionsGuard existente agora suporta alternativa explícita de papéis em cada endpoint (PermissionsOrRoles), sem bypass global implícito. Leitura e escrita financeiras exigem permissões já existentes, ou OWNER/SUPER_ADMIN; RolesGuard continua obrigatório. Gestão de contas restrita a OWNER/SUPER_ADMIN.
- Dashboard summary incluía receita e cobranças para RECEPTION. Agora usuários sem financial:read não consultam nem recebem esses campos. Revenue/overdue protegidos por permissão. Consultas sem tenant são recusadas antes de consultar storage.
- Criação de equipe restrita a OWNER/SUPER_ADMIN. MANAGER não administra identidades pela rota /users.
- Assinatura IRON (estado, checkout, troca e cancelamento) e configuração do plano da academia restritas a OWNER. Rotas globais de SUPER_ADMIN preservadas. Preços publicados permanecem consultáveis para o gerente, sem permitir contratação.
- Analytics de criadores inclui valores comerciais; rota restrita a OWNER/SUPER_ADMIN. Visão operacional de conteúdo permanece disponível para gerente.
- Treinos e agenda incluíam objetos completos de User nas respostas. Projeção explícita publicUserSelect exclui passwordHash, mfaSecret e outros campos de autenticação; aplicada também nas consultas de alunos/avaliações. Assinatura financeira retorna apenas ID/nome do aluno.
- Privacidade: pedidos e aceites pessoais continuam vinculados a user.id. Revisão e governança de pedidos continuam SUPER_ADMIN. Não foi encontrada uma superfície judicial empresarial nesta auditoria; não declarada como implementada/certificada.

## Matriz
| Operação | Proprietário | Gerente/Recepção | Professor/Aluno |
|---|---|---|---|
| Consulta financeira | Sim | Só financial:read e cargo autorizado | Não |
| Cobrança/baixa de pagamento | Sim | Só financial:write e cargo autorizado | Não |
| Criar conta financeira | Sim | Não | Não |
| Gestão de equipe | Sim | Não | Não |
| Assinatura IRON/configuração de plano | Sim | Não | Não |
| Segurança da própria conta | Sim | Sim | Sim |

Permissões provêm das atribuições canônicas do tenant resolvidas pela autenticação; não foi criado mecanismo paralelo ou painel de concessão. As permissões existentes são vinculadas a papéis, não um novo ACL individual. Novos privilégios não foram concedidos.

## Evidências
Local: lint, typecheck e build aprovados; 617/617 testes, zero falhas/ignorados. Dez regressões novas cobrem matriz de cargos, separação read/write, minimização do dashboard, tenant obrigatório, projeção pública e HTTP real contra FinancialController com RolesGuard/PermissionsGuard reais. Somente autenticação é substituída no servidor loopback do teste; nenhuma conta real é criada.
Três verificações antigas foram atualizadas para o contrato mais restritivo: OWNER em lugar de OWNER/MANAGER e select explícito no lugar de user:true. Nenhuma asserção de tenant foi retirada.

Gate: aguarda CI remoto, merge autorizado somente verde, deploy e pós-merge. Resultado final deve constar da PR. Estes testes não homologam gateways, migrations pendentes, recuperação de desastre ou GO-LIVE. Mudança é restritiva; funcionários antes autorizados pelo cargo precisarão de permissão financeira existente. Não reverter a proteção para recuperar conveniência de UI.
