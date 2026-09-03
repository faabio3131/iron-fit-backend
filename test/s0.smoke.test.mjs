import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { HealthController } = require('../dist/src/health.controller.js');
const { WorkoutsService } = require('../dist/src/modules/workouts/workouts.service.js');

test('health controller returns deterministic service metadata', () => {
  const result = new HealthController().check();

  assert.equal(result.status, 'ok');
  assert.equal(result.service, 'gym-saas-backend');
  assert.equal(result.version, '0.1.0');
  assert.ok(typeof result.timestamp === 'string' && result.timestamp.length > 0);
});

test('workouts findAll scopes listing by authenticated gym when provided', async () => {
  const calls = [];
  const prisma = {
    workout: {
      findMany: async (args) => {
        calls.push(args);
        return [];
      },
    },
  };

  const service = new WorkoutsService(prisma);
  const result = await service.findAll('gym-a');

  assert.deepEqual(result, []);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where, { student: { gymId: 'gym-a' } });
  assert.deepEqual(calls[0].orderBy, { createdAt: 'desc' });
  assert.equal(calls[0].include.student.include.user, true);
});

test('workouts findAll remains callable without tenant for privileged future handling', async () => {
  const calls = [];
  const prisma = {
    workout: {
      findMany: async (args) => {
        calls.push(args);
        return [];
      },
    },
  };

  const service = new WorkoutsService(prisma);
  await service.findAll();

  assert.deepEqual(calls[0].where, {});
});
