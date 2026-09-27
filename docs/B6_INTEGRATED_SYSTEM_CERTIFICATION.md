# IRON — Bloco 6 — Recertificação Integrada Web + Backend + Mobile

Status: CANDIDATE — certificação interna de sistema em execução.

## Objetivo

Certificar o IRON como sistema integrado, não apenas como componentes isolados.

A certificação combina:

1. PostgreSQL 18 real e efêmero no CI;
2. todas as migrations aplicadas do zero;
3. backend NestJS real ouvindo HTTP;
4. jornadas de negócio executadas pelos controllers/guards/validation/persistence reais;
5. regressão S0–S12 e regressões posteriores;
6. E2E Web/mobile do `iron-fit-app`;
7. exports Android/Web e containers reprodutíveis.

Não há uso do Supabase legado como fonte de homologação.

## Matriz integrada

A jornada HTTP real cobre:

1. criação de trial;
2. replay idempotente de trial;
3. login OWNER;
4. onboarding completo;
5. OWNER / MANAGER / TRAINER / STUDENT;
6. privilege escalation negada;
7. cadastro + convite + ativação de aluno;
8. equipamento;
9. assessment;
10. workout;
11. revisão humana / ativação;
12. AI provider ausente => fail-closed;
13. agenda + booking + check-in;
14. acesso + histórico de eventos;
15. financeiro do aluno;
16. pricing SaaS;
17. trial → paid;
18. entitlements após pagamento;
19. upgrade;
20. downgrade agendado;
21. recorrência;
22. inadimplência / suspensão;
23. reativação por pagamento;
24. cross-tenant denial;
25. token JWT adulterado;
26. refresh rotation + replay revogando sessão;
27. password reset + reset replay;
28. sessão antiga invalidada após reset;
29. MFA exigido;
30. bypass de MFA negado;
31. listagem de sessões;
32. burst concorrente em endpoints críticos;
33. brute-force rate limit;
34. logout + sessão revogada;
35. reconciliation SaaS sem mismatch.

## Cross-surface

O app mantém os E2E permanentes:

- Web: trial → login → dashboard tenant-scoped;
- mobile: login, seleção de tenant, workouts, IA degradada segura, financeiro, perfil e logout.

O backend integrado exercita o mesmo domínio canônico que Web/mobile consomem.

Nenhum frontend persiste autoridade de negócio paralela.

## Segurança

O B6 não substitui S0–S12. O gate executa:

- dependency audit;
- Prisma generate;
- migrations fresh-install;
- lint/typecheck;
- build;
- todos os testes permanentes;
- jornada HTTP integrada;
- Docker production build.

## Performance e resiliência

O smoke de sistema executa burst concorrente de requisições HTTP e exige conclusão sem erro dentro do orçamento do CI.

Também valida degradação segura quando a IA externa não possui configuração/provider real.

Este bloco não substitui load testing de produção com tráfego e topologia reais.

## Limites factuais

Homologação física externa do conjunto permanece bloqueada enquanto não existir banco CURRENT seguro + runtime externo IRON comprovado.

O B6 pode certificar integralmente o escopo interno/reproduzível sem declarar produção externa.
