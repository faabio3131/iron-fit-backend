# O9 — Agenda Premium — API Read Model

Status: **CANDIDATE**

O CURRENT de Agenda possuía:
- horários recorrentes por tenant em `GET /schedule-slots`;
- agendamentos por aluno em `GET /students/:studentId/schedules`;
- criação de agendamento e check-in governados.

Para a superfície semanal da Agenda, consultar aluno por aluno no frontend criaria N+1 e faria a UI montar uma segunda projeção operacional. O domínio canônico agora expõe `GET /schedules` como read model tenant-safe.

Filtros opcionais:
- `from`;
- `to`;
- `status`;
- `studentId`.

A consulta:
- deriva o tenant da sessão/escopo canônico;
- restringe simultaneamente `Student` e `ScheduleSlot` ao mesmo gym;
- inclui aluno e slot para renderização;
- limita a 500 registros;
- não altera autoridade de escrita.

RBAC preservado:
- leitura: SUPER_ADMIN, OWNER, MANAGER, RECEPTION, TRAINER;
- criar agendamento/check-in: SUPER_ADMIN, OWNER, MANAGER, RECEPTION;
- criar horário: SUPER_ADMIN, OWNER, MANAGER.
