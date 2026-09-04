import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('S10 liveness is independent from PostgreSQL readiness', () => {
  const { HealthController } = require('../dist/src/health.controller.js');
  let databaseCalls = 0;
  const controller = new HealthController({
    $queryRaw: async () => {
      databaseCalls += 1;
      return [{ '?column?': 1 }];
    },
  });

  const result = controller.live();
  assert.equal(result.status, 'ok');
  assert.equal(result.probe, 'liveness');
  assert.equal(databaseCalls, 0);
});

test('S10 readiness reports PostgreSQL up only after a real query succeeds', async () => {
  const { HealthController } = require('../dist/src/health.controller.js');
  let databaseCalls = 0;
  const controller = new HealthController({
    $queryRaw: async () => {
      databaseCalls += 1;
      return [{ '?column?': 1 }];
    },
  });

  const result = await controller.ready();
  assert.equal(databaseCalls, 1);
  assert.equal(result.status, 'ok');
  assert.equal(result.probe, 'readiness');
  assert.equal(result.dependencies.postgres, 'up');
});

test('S10 readiness fails closed with 503 when PostgreSQL is unavailable', async () => {
  const { HealthController } = require('../dist/src/health.controller.js');
  const controller = new HealthController({
    $queryRaw: async () => {
      throw new Error('postgres password must never escape');
    },
  });

  await assert.rejects(
    () => controller.ready(),
    (error) => {
      assert.equal(error.getStatus(), 503);
      const response = error.getResponse();
      assert.equal(response.status, 'unavailable');
      assert.equal(response.dependencies.postgres, 'down');
      assert.equal(JSON.stringify(response).includes('password'), false);
      return true;
    },
  );
});

test('S10 request observability uses correlation IDs and excludes sensitive request material', async () => {
  const source = await readFile('src/common/middleware/request-observability.middleware.ts', 'utf8');
  assert.equal(source.includes("res.setHeader('X-Request-Id', requestId)"), true);
  assert.equal(source.includes("event: 'http_request_completed'"), true);
  assert.equal(source.includes('requestId,'), true);
  assert.equal(source.includes('statusCode: res.statusCode'), true);
  assert.equal(source.includes('req.body'), false);
  assert.equal(source.includes('req.headers.authorization'), false);
  assert.equal(source.includes('cookie'), false);
});

test('S10 production runtime enables graceful Nest shutdown hooks and structured startup logging', async () => {
  const source = await readFile('src/main.ts', 'utf8');
  assert.equal(source.includes('app.enableShutdownHooks()'), true);
  assert.equal(source.includes("event: 'service_started'"), true);
  assert.equal(source.includes("new Logger('Bootstrap').log"), true);
  assert.equal(source.includes('console.log'), false);
});
