import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(path, 'utf8');

test('O10 Access Center exposes tenant-scoped credentials, devices and filtered events', async () => {
  const controller = await source('src/modules/access/access.controller.ts');
  const service = await source('src/modules/access/access.service.ts');

  assert.match(controller, /@Get\('credentials'\)/);
  assert.match(controller, /@Get\('devices'\)/);
  assert.match(controller, /@Get\('events'\)/);
  assert.match(controller, /@Patch\('credentials\/:id\/revoke'\)/);
  assert.match(controller, /resolveTenantOperationGymId/);

  assert.match(service, /student: \{ gymId \}/);
  assert.match(service, /where: \{ id, student: \{ gymId \} \}/);
  assert.match(service, /gymId,/);
  assert.match(service, /deviceId: filters\.deviceId/);
  assert.match(service, /allowed !== undefined/);
});

test('O10 never exposes credential or device secret material through read models', async () => {
  const service = await source('src/modules/access/access.service.ts');
  const credentialRead = service.slice(
    service.indexOf('async findCredentials'),
    service.indexOf('async revokeCredential'),
  );
  const deviceRead = service.slice(
    service.indexOf('async findDevices'),
    service.indexOf('async createCredential'),
  );

  assert.doesNotMatch(credentialRead, /tokenHash: true/);
  assert.doesNotMatch(credentialRead, /biometricHash: true/);
  assert.doesNotMatch(deviceRead, /deviceTokenHash: true/);
  assert.match(deviceRead, /tokenRotatedAt: true/);
});

test('O10 preserves least privilege between operational access and device administration', async () => {
  const controller = await source('src/modules/access/access.controller.ts');

  assert.match(
    controller,
    /@Get\('credentials'\)[\s\S]*?@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'\)/,
  );
  assert.match(
    controller,
    /@Patch\('credentials\/:id\/revoke'\)[\s\S]*?@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION'\)/,
  );
  assert.match(
    controller,
    /@Get\('devices'\)[\s\S]*?@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER'\)/,
  );
  assert.match(
    controller,
    /@Post\('devices\/:deviceId\/token'\)[\s\S]*?@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER'\)/,
  );
});
