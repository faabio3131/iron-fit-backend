# O10 — Access Center

Status: **CANDIDATE**

O domínio de acesso já possuía:
- emissão one-time de credencial;
- decisão física server-side;
- autenticação de dispositivo;
- nonce/replay protection;
- auditoria;
- eventos tenant-scoped;
- rotação one-time de token de dispositivo.

O10 adiciona somente as superfícies canônicas necessárias ao produto comercial:

- `GET /access/credentials` — credenciais do tenant sem hashes/tokens;
- `PATCH /access/credentials/:id/revoke` — revogação tenant-safe e auditada;
- `GET /access/devices` — metadados seguros dos dispositivos configurados;
- `GET /access/events` — timeline enriquecida com aluno/dispositivo e filtros.

Filtros de eventos:
- aluno;
- dispositivo;
- permitido/negado;
- intervalo de datas.

RBAC:
- credenciais/eventos: SUPER_ADMIN, OWNER, MANAGER, RECEPTION;
- dispositivos/rotação de token: SUPER_ADMIN, OWNER, MANAGER.

Nenhum token, hash de credencial, hash biométrico ou hash de dispositivo é exposto pelos read models.
