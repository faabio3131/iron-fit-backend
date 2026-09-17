import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');

test('M3 read controllers are authenticated, role-gated and tenant-resolved', async () => {
  const files = await Promise.all([
    read('src/modules/access/access-read.controller.ts'),
    read('src/modules/schedules/schedules-read.controller.ts'),
    read('src/modules/financial/financial-read.controller.ts'),
  ]);
  for (const source of files) {
    assert.match(source, /@UseGuards\(JwtAuthGuard, RolesGuard\)/);
    assert.match(source, /resolveTenantOperationGymId/);
    assert.match(source, /activeGymId:\s*user\.activeGymId\s*\?\?\s*user\.gymId/);
    assert.match(source, /isSuperAdmin:\s*user\.isSuperAdmin\s*===\s*true/);
  }
  assert.match(files[0], /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'\)/);
  assert.match(files[1], /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER'\)/);
  assert.match(files[2], /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'\)/);
});

test('M3 read models enforce gym scope and bounded queries', async () => {
  const access = await read('src/modules/access/access-read.service.ts');
  const schedules = await read('src/modules/schedules/schedules-read.service.ts');
  const financial = await read('src/modules/financial/financial-read.service.ts');

  assert.match(access, /where:\s*\{\s*gymId\s*\}/);
  assert.match(access, /Math\.min[\s\S]*200/);
  assert.match(schedules, /student:\s*\{\s*gymId\s*\}/);
  assert.match(schedules, /slot:\s*\{\s*gymId\s*\}/);
  assert.match(schedules, /take:\s*500/);
  assert.match(financial, /where:\s*\{\s*gymId\s*\}/);
  assert.match(financial, /take:\s*500/);
});

test('M3 read-only support does not alter critical decision services', async () => {
  const access = await read('src/modules/access/access.service.ts');
  const schedules = await read('src/modules/schedules/schedules.service.ts');
  const financial = await read('src/modules/financial/financial.service.ts');
  assert.match(access, /async scan\(/);
  assert.match(access, /Replay detectado/);
  assert.match(schedules, /isolationLevel:\s*'Serializable'/);
  assert.match(schedules, /Slot lotado/);
  assert.match(financial, /MAX_SERIALIZABLE_RETRIES/);
  assert.match(financial, /FISCAL_HANDOFF_PENDING_CAPABILITY/);
});
