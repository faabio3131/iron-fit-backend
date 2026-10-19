import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { FmCommandControlPlaneService } = require('../dist/src/modules/fm-command/fm-command-control-plane.service.js');

function setup() {
  const calls = [];
  const prisma = {
    aiExecutionTrace: {
      groupBy: async (args) => {
        calls.push(args);
        return [{
          gymId: 'gym-one',
          capability: 'WORKOUT_GENERATION',
          providerCode: 'null_provider',
          modelCode: 'offline',
          status: 'UNAVAILABLE',
          _count: { _all: 3 },
        }];
      },
    },
  };
  return { calls, service: new FmCommandControlPlaneService(prisma, {}, {}) };
}

test('D9 AI usage exposes only canonical aggregated execution counts with truthful missing-cost semantics', async () => {
  const { calls, service } = setup();
  const result = await service.aiUsage('7');
  assert.equal(result.schema_version, 'iron.fmcc.ai-usage.v1');
  assert.equal(result.product_code, 'IRON_FIT_CORE');
  assert.equal(result.window_days, 7);
  assert.equal(result.usage.length, 1);
  assert.deepEqual(result.usage[0], {
    tenant_id: 'gym-one',
    capability: 'WORKOUT_GENERATION',
    provider_code: 'null_provider',
    model_code: 'offline',
    status: 'UNAVAILABLE',
    execution_count: 3,
  });
  assert.deepEqual(result.unavailable_metrics, ['input_tokens', 'output_tokens', 'provider_cost_minor']);
  assert.equal(result.provenance.commercial_authority, 'FM_COMMAND');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].by, ['gymId', 'capability', 'providerCode', 'modelCode', 'status']);
  assert.deepEqual(calls[0]._count, { _all: true });
  assert.ok(calls[0].where.createdAt.gte instanceof Date);
  assert.ok(calls[0].where.createdAt.lt instanceof Date);
  for (const prohibited of ['studentId', 'actorId', 'inputHash', 'outputHash', 'promptKey', 'requestId', 'secretReference', 'email']) {
    assert.equal(JSON.stringify(result).includes(prohibited), false);
  }
});

test('D9 AI usage enforces a bounded window and never queries arbitrary tenants from request parameters', async () => {
  const { calls, service } = setup();
  for (const days of ['0', '00', '-1', '91', '100', '12.5', 'abc', ' ', '999999']) {
    await assert.rejects(() => service.aiUsage(days), (error) => error.getStatus?.() === 400);
  }
  assert.equal(calls.length, 0);
  const defaultReport = await service.aiUsage();
  assert.equal(defaultReport.window_days, 30);
  assert.equal(calls.length, 1);
});

test('D9 AI usage is behind existing FM Command server-to-server guard without tenant or credential inputs', async () => {
  const controller = await readFile('src/modules/fm-command/fm-command-control-plane.controller.ts', 'utf8');
  const guard = await readFile('src/modules/fm-command/fm-command-control-plane.guard.ts', 'utf8');
  assert.match(controller, /@UseGuards\(FmCommandControlPlaneGuard\)/);
  assert.match(controller, /@Get\('usage\/ai'\)/);
  assert.match(controller, /@Query\('days'\) days\?: string/);
  assert.doesNotMatch(controller, /@Query\('tenantId'\)|@Body\('tenantId'\)/);
  assert.match(guard, /timingSafeEqual/);
  assert.match(guard, /FMCC_IRON_CONTROL_PLANE_TOKEN/);
});
