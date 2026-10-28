import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Reflector } = require('@nestjs/core');
const { RolesGuard } = require('../dist/src/common/guards/roles.guard.js');
const { AiConfigurationAdminController } = require('../dist/src/modules/ai/configuration/ai-configuration-admin.controller.js');
const { AiConfigurationAdminService } = require('../dist/src/modules/ai/configuration/ai-configuration-admin.service.js');

test('AI-MP configuration controller permits SUPER_ADMIN only across all six roles', () => {
  const guard = new RolesGuard(new Reflector());
  for (const role of ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER', 'STUDENT']) {
    const context = { getHandler: () => AiConfigurationAdminController.prototype.create, getClass: () => AiConfigurationAdminController,
      switchToHttp: () => ({ getRequest: () => ({ user: { roles: [role] } }) }) };
    assert.equal(guard.canActivate(context), role === 'SUPER_ADMIN');
  }
});

test('AI-MP failed step-up cannot query credentials or persist a profile', async () => {
  let reads = 0, writes = 0;
  const service = new AiConfigurationAdminService(
    { integrationConnection: { findMany: async () => { reads++; return []; } } },
    { assertStepUp: async () => { throw new Error('step-up denied'); } }, {}, {},
    { createConfigurationProfile: async () => { writes++; } });
  await assert.rejects(() => service.create('admin', { currentPassword: 'invalid' }), /step-up denied/);
  assert.equal(reads, 0); assert.equal(writes, 0);
});
