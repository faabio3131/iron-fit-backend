import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { ModulesContainer } = require('@nestjs/core/injector/modules-container');
const { PrismaService } = require('../dist/src/prisma/prisma.service.js');
const { PrismaModule } = require('../dist/src/prisma/prisma.module.js');
const { SchedulesModule } = require('../dist/src/modules/schedules/schedules.module.js');
const { AccessModule } = require('../dist/src/modules/access/access.module.js');
const { DashboardModule } = require('../dist/src/modules/dashboard/dashboard.module.js');
const { SchedulesService } = require('../dist/src/modules/schedules/schedules.service.js');
const { AccessService } = require('../dist/src/modules/access/access.service.js');
const { DashboardService } = require('../dist/src/modules/dashboard/dashboard.service.js');

test('feature modules share one Prisma client, connect once and disconnect once', async (t) => {
  let connects = 0;
  let disconnects = 0;
  t.mock.method(PrismaService.prototype, '$connect', async () => { connects += 1; });
  t.mock.method(PrismaService.prototype, '$disconnect', async () => { disconnects += 1; });
  class RuntimeProbeModule {}
  Module({ imports: [PrismaModule, SchedulesModule, AccessModule, DashboardModule] })(RuntimeProbeModule);
  const app = await NestFactory.createApplicationContext(RuntimeProbeModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    assert.equal(app.get(SchedulesService).prisma, prisma);
    assert.equal(app.get(AccessService).prisma, prisma);
    assert.equal(app.get(DashboardService).prisma, prisma);
    const registrations = [...app.get(ModulesContainer).values()]
      .filter((module) => module.providers.has(PrismaService));
    assert.equal(registrations.length, 1);
    assert.equal(connects, 1);
  } finally {
    await app.close();
  }
  assert.equal(disconnects, 1);
});
