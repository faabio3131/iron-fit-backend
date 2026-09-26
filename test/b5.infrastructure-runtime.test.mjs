import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = (path) => readFile(path, 'utf8');

test('B5 deploy artifacts use one production-shaped Node runtime with Prisma migrate deploy', async () => {
  const docker = await source('Dockerfile');
  const railway = await source('railway.toml');
  assert.match(docker, /FROM node:22-bookworm-slim AS build/);
  assert.match(docker, /RUN npx prisma generate/);
  assert.match(docker, /RUN npm run build/);
  assert.match(docker, /CMD \["node", "dist\/src\/main\.js"\]/);
  assert.match(railway, /builder = "DOCKERFILE"/);
  assert.match(railway, /startCommand = "node dist\/src\/main\.js"/);
  assert.match(railway, /preDeployCommand = \["npx prisma migrate deploy"\]/);
  assert.match(railway, /healthcheckPath = "\/api\/v1\/health\/ready"/);
  assert.match(railway, /restartPolicyType = "ON_FAILURE"/);
});

test('B5 container context excludes local secrets', async () => {
  const ignore = await source('.dockerignore');
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
});

test('B5 runtime metrics are aggregate-only and request logs exclude sensitive material', async () => {
  const metrics = await source('src/common/observability/runtime-metrics.service.ts');
  const middleware = await source('src/common/middleware/request-observability.middleware.ts');
  assert.match(metrics, /requestTotal/);
  assert.match(metrics, /error5xxTotal/);
  assert.match(metrics, /averageDurationMs/);
  assert.match(metrics, /heapUsedBytes/);
  assert.match(middleware, /this\.metrics\.observeHttp/);
  assert.equal(middleware.includes('req.body'), false);
  assert.equal(middleware.includes('authorization'), false);
  assert.equal(middleware.includes('cookie'), false);
});

test('B5 metrics endpoint exposes no tenant or user dimension', async () => {
  const controller = await source('src/metrics.controller.ts');
  assert.match(controller, /@Get\('metrics'\)/);
  assert.match(controller, /this\.metrics\.snapshot\(\)/);
  assert.equal(controller.includes('gymId'), false);
  assert.equal(controller.includes('userId'), false);
});

test('B5 runbook explicitly separates homologation evidence from production claims', async () => {
  const doc = await source('docs/B5_INFRASTRUCTURE_HOMOLOGATION_RUNBOOK.md');
  assert.match(doc, /não declara produção real sem evidência física/);
  assert.match(doc, /DEV, HOMOLOG e PROD executam a mesma aplicação/);
  assert.match(doc, /forward-only/);
  assert.match(doc, /Nunca executar teste destrutivo de restore diretamente sobre produção/);
  assert.match(doc, /A ausência de ruleset não pode ser escondida/);
});
