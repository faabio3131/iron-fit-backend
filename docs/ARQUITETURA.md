# 🏋️ IronCloud Gym SaaS - Documentação de Arquitetura e Sistema

**Versão:** 1.0.0  
**Data da Última Atualização:** Setembro 2026  
**Status:** Produção (Live)  
**Repositório Backend:** [github.com/faabio3131/gym-saas-backend](https://github.com/faabio3131/gym-saas-backend)

---

## 1. 🏗️ Visão Geral da Arquitetura

O sistema segue uma arquitetura **Client-Server** moderna, separando claramente frontend, backend e banco de dados, permitindo escalabilidade e manutenção independente.

### 1.1 Diagrama de Infraestrutura

\\\	ext
┌─────────────────────┐       ┌──────────────────────┐       ┌─────────────────────┐
│   CLIENTES (Front)  │       │   BACKEND (API)      │       │   DADOS & INFRA     │
│                     │       │                      │       │                     │
│   App Mobile      │──────▶│   Render (Node.js) │──────▶│  🗄️ Supabase (Postgres)│
│  (Expo/React Native)│ HTTPS │  (NestJS + Prisma)   │ SQL   │  (Banco Relacional) │
│                     │       │                      │       │                     │
│  💻 Painel Admin    │──────▶│  🔒 Auth (JWT)       │       │  ☁️ Storage (Imagens) │
│  (React/Vite)       │ HTTPS │  🛡️ Guards (Roles)   │       │                     │
└─────────────────────┘       └──────────────────────┘       └─────────────────────┘
         ▲                              ▲
         │                              │
         └────────── Git Push ──────────┘
               (Auto-Deploy)
\\\

### 1.2 Tecnologias Utilizadas

| Camada | Tecnologia | Versão | Função |
|--------|------------|--------|--------|
| **Backend** | NestJS | v10+ | Framework API REST |
| **Linguagem** | TypeScript | v5+ | Tipagem estática |
| **ORM** | Prisma | v5+ | Acesso ao banco de dados |
| **Banco de Dados** | PostgreSQL | 15+ | Via Supabase |
| **Auth** | JWT + Bcrypt | - | Tokens e Senhas |
| **Painel Web** | React + Vite | v5+ | Dashboard do Dono |
| **App Mobile** | Expo (React Native) | SDK 50+ | App do Aluno/Treinador |
| **Infra** | Render + Supabase | Free Tier | Hospedagem e DB |

---

## 2. 🔒 Segurança e Autenticação

### 2.1 Fluxo de Login
1.  Usuário envia \mail\ e \senha\ para \POST /auth/login\.
2.  Backend valida credenciais no banco (senha comparada com hash bcrypt).
3.  Se válido, gera **JWT Token** contendo: \id\, \mail\, \ole\, \gymId\.
4.  Frontend armazena token (LocalStorage/SecureStore) e usa no header \Authorization: Bearer <token>\.

### 2.2 Controle de Acesso (RBAC - Roles)
O sistema utiliza **Guards** no NestJS para proteger rotas baseadas em cargos:

| Role | Permissões Principais |
|------|-----------------------|
| \SUPER_ADMIN\ | Acesso total a todas as academias (God mode). |
| \OWNER\ | Dono da academia. Gestão total da sua unidade (alunos, financeiro, treinos). |
| \MANAGER\ | Gerente. Opera como o dono, mas sem acesso a configurações críticas da conta. |
| \TRAINER\ | Treinador. Cria treinos, vê alunos, mas não acessa financeiro sensível. |
| \STUDENT\ | Aluno. Vê apenas seus próprios treinos, agenda e pagamentos. |

**Endpoints Protegidos:** Todos os endpoints (exceto \/auth/login\ e \/auth/register\) exigem token JWT válido.

---

## 3. ️ Modelo de Dados (Prisma Schema)

O banco de dados é relacional, focado em integridade. Principais entidades:

### 3.1 Entidades Core
*   **User:** Dados de login e perfil global.
*   **Gym:** A academia/unidade de negócio.
*   **Student:** Perfil do aluno vinculado a uma Gym e a um User.
*   **Assessment:** Avaliação física (dobras, medidas, peso) vinculada ao Student.
*   **Workout:** O treino prescrito. Contém Sessions e Exercises.
*   **Session:** Divisão do treino (ex: "Treino A - Peito").
*   **Exercise:** Exercício específico dentro da sessão (com séries, reps, carga).
*   **Charge:** Cobrança financeira (mensalidade) com status (PENDING, PAID, OVERDUE).
*   **Schedule:** Horários disponíveis para reserva de aula.

### 3.2 Relacionamentos Chave
*   \Gym\ 1:N \Student\
*   \Student\ 1:N \Workout\
*   \Workout\ 1:N \Session\ -> 1:N \Exercise\
*   \Student\ 1:N \Charge\

*(Ver arquivo \prisma/schema.prisma\ no repositório para detalhes técnicos dos tipos).*

---

## 4. 🔌 API Endpoints Principais

Base URL: \https://gym-saas-backend-t9ej.onrender.com/api/v1\

### Auth
*   \POST /auth/login\ - Login (Retorna JWT)
*   \POST /auth/register\ - Registro de novo usuário/dono

### Dashboard
*   \GET /dashboard/stats\ - Resumo estatístico (total alunos, receita, etc.)

### Alunos (Students)
*   \GET /students\ - Lista todos os alunos da academia (Owner/Manager)
*   \POST /students\ - Cadastra novo aluno
*   \PATCH /students/:id\ - Atualiza dados do aluno

### Treinos (Workouts)
*   \GET /workouts\ - Lista todos os treinos da academia (**Novo Endpoint**)
*   \GET /students/:studentId/workouts\ - Lista treinos de um aluno específico
*   \POST /workouts\ - Cria novo treino (com sessões e exercícios aninhados)
*   \PATCH /workouts/:id/status\ - Aprova ou Rejeita treino (DRAFT → APPROVED)

### Financeiro
*   \GET /financial/charges\ - Lista cobranças
*   \POST /financial/charges\ - Lança nova cobrança
*   \PATCH /financial/charges/:id/pay\ - Confirma pagamento

### Agenda
*   \GET /schedules\ - Consulta horários disponíveis
*   \POST /schedules\ - Abre novo horário
*   \POST /schedules/:id/book\ - Reserva vaga (Aluno)

---

## 5. 🚀 Deploy e CI/CD

### 5.1 Backend (Render)
*   **Trigger:** Push na branch \main\ do GitHub.
*   **Build Command:** \
pm run build\ (NestJS compila para JS).
*   **Start Command:** \
ode dist/main.js\.
*   **Variáveis de Env:** \DATABASE_URL\ (Supabase), \JWT_SECRET\.
*   **Status:** Auto-deploy habilitado.

### 5.2 Frontend (Painel & App)
*   **Painel:** Roda localmente (\
pm run dev\) ou pode ser deployado na Vercel/Netlify.
*   **App:** Desenvolvido em Expo. Gera builds via \as build\ (não há deploy automático contínuo configurado, processo manual via EAS).

---

## 6. ✅ Checklist de Auditoria (Status Atual)

Use esta lista para validar a saúde do sistema antes de novas implementações.

### Segurança
- [x] JWT implementado com expiração.
- [x] Senhas hasheadas com bcrypt (salt 10).
- [x] Roles validadas em todos os endpoints críticos.
- [ ] Rate Limiting (A implementar).
- [ ] Logs de auditoria de ações sensíveis (A implementar).

### Funcional
- [x] CRUD de Alunos funcional.
- [x] Criação e Aprovação de Treinos funcional.
- [x] Lançamento e Baixa de Pagamentos funcional.
- [x] Seed de dados inicial funcionando.
- [ ] Recuperação de senha (Esqueci minha senha) (A implementar).

### Infraestrutura
- [x] Backend no ar (Render).
- [x] Banco de dados conectado (Supabase).
- [x] CORS configurado para localhost e domínios de produção.
- [ ] Backup automático do banco testado (Gerenciado pelo Supabase).

---

## 7. 📂 Estrutura de Pastas do Projeto

\\\	ext
gym-saas-backend/
├── src/
│   ├── modules/          # Módulos de negócio (auth, students, workouts...)
│   ├── common/           # Guards, Decorators, Filters
│   ├── prisma/           # Schema e Seeds
│   ── main.ts           # Entry point
├── docs/                 # Documentação do projeto
│   └── ARQUITETURA.md    # Este arquivo
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── .env                  # Variáveis de ambiente (NÃO COMMITAR)
└── package.json

ironcloud-admin/ (Painel)
├── src/
│   ├── pages/            # Telas (Dashboard, Alunos, Treinos...)
│   ├── services/         # Chamadas API
│   └── App.tsx
── package.json

gym-saas-app/ (Mobile)
├── src/
│   ├── screens/          # Telas Mobile
│   ── services/
└── app.json
\\\

---

**Fim da Documentação.**
*Gerado para auditoria do projeto IronCloud Gym SaaS.*
