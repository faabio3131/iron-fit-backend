import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(path, 'utf8');
}

test('M3 access history is authenticated, RBAC protected and tenant-scoped', async () => {
  const controller = await source('src/modules/access/access.controller.ts');
  const service = await source('src/modules/access/access.service.ts');

  assert.match(controller, /@Get\('events'\)/);
  assert.match(controller, /@UseGuards\(JwtAuthGuard, RolesGuard\)/);
  assert.match(controller, /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'\)/);
  assert.match(controller, /resolveTenantOperationGymId/);
  assert.match(controller, /activeGymId: user\.activeGymId \?\? user\.gymId/);
  assert.match(service, /findRecentEvents\(gymId: string\)/);
  assert.match(service, /where: \{ gymId \}/);
  assert.match(service, /take: ACCESS_EVENT_HISTORY_LIMIT/);
});

test('M3 access history exposes facts only and does not move physical authorization into the Web', async () => {
  const controller = await source('src/modules/access/access.controller.ts');
  const service = await source('src/modules/access/access.service.ts');

  const history = service.slice(service.indexOf('async findRecentEvents'), service.indexOf('async createCredential'));
  assert.match(history, /accessEvent\.findMany/);
  assert.equal(history.includes('accessEvent.create'), false);
  assert.equal(history.includes('allowed ='), false);
  assert.equal(history.includes('scan('), false);
  assert.match(controller, /@Post\('scan'\)/);
});
