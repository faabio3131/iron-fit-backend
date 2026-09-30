import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(path, 'utf8');

test('O9 exposes a tenant-scoped calendar read endpoint without widening write authority', async () => {
  const controller = await source('src/modules/schedules/schedules.controller.ts');

  assert.match(controller, /@Get\('schedules'\)/);
  assert.match(
    controller,
    /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER'\)/,
  );
  assert.match(controller, /resolveTenantOperationGymId/);
  assert.match(controller, /findAllSchedules\(gymId/);

  assert.match(
    controller,
    /@Post\('schedules'\)[\s\S]*?@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'\)/,
  );
  assert.match(
    controller,
    /@Patch\('schedules\/:id\/check-in'\)[\s\S]*?@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'\)/,
  );
});

test('O9 calendar service is tenant-safe and bounded', async () => {
  const service = await source('src/modules/schedules/schedules.service.ts');

  assert.match(service, /student: \{ gymId \}/);
  assert.match(service, /slot: \{ gymId \}/);
  assert.match(service, /take: 500/);
  assert.match(service, /Status de agendamento invalido/);
  assert.match(
    service,
    /Data inicial nao pode ser posterior a data final/,
  );
  assert.match(
    service,
    /student: \{ include: \{ user: true \} \}/,
  );
  assert.match(service, /slot: true/);
});
