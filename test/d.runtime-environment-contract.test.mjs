import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const source = (path) => readFile(path, 'utf8');

test('D runtime environment accepts only DEV HOMOLOG PROD and normalizes case', () => {
  const {
    parseIronRuntimeEnvironment,
    requireIronRuntimeEnvironment,
  } = require(
    '../dist/src/common/runtime/iron-runtime-environment.js',
  );

  assert.equal(parseIronRuntimeEnvironment('dev'), 'DEV');
  assert.equal(parseIronRuntimeEnvironment(' homolog '), 'HOMOLOG');
  assert.equal(parseIronRuntimeEnvironment('PROD'), 'PROD');
  assert.equal(parseIronRuntimeEnvironment('staging'), null);
  assert.equal(parseIronRuntimeEnvironment(undefined), null);
  assert.throws(
    () => requireIronRuntimeEnvironment('staging'),
    /IRON_RUNTIME_ENV/,
  );
});

test('D bootstrap fails fast without runtime or database authority', () => {
  const {
    assertRuntimeBootstrapContract,
  } = require(
    '../dist/src/common/runtime/iron-runtime-environment.js',
  );

  assert.throws(
    () => assertRuntimeBootstrapContract({
      DATABASE_URL: 'postgresql://example',
    }),
    /IRON_RUNTIME_ENV/,
  );

  assert.throws(
    () => assertRuntimeBootstrapContract({
      IRON_RUNTIME_ENV: 'HOMOLOG',
    }),
    /DATABASE_URL/,
  );

  assert.equal(
    assertRuntimeBootstrapContract({
      IRON_RUNTIME_ENV: 'HOMOLOG',
      DATABASE_URL: 'postgresql://example',
      NODE_ENV: 'production',
    }),
    'HOMOLOG',
  );
});

test('D production runtime cannot start with a non-production Node mode', () => {
  const {
    assertRuntimeBootstrapContract,
  } = require(
    '../dist/src/common/runtime/iron-runtime-environment.js',
  );

  assert.throws(
    () => assertRuntimeBootstrapContract({
      IRON_RUNTIME_ENV: 'PROD',
      DATABASE_URL: 'postgresql://example',
      NODE_ENV: 'development',
    }),
    /PROD exige NODE_ENV=production/,
  );

  assert.equal(
    assertRuntimeBootstrapContract({
      IRON_RUNTIME_ENV: 'PROD',
      DATABASE_URL: 'postgresql://example',
      NODE_ENV: 'production',
    }),
    'PROD',
  );
});

test('D application bootstrap validates environment before Nest runtime starts', async () => {
  const main = await source('src/main.ts');
  const validation = main.indexOf('assertRuntimeBootstrapContract()');
  const nest = main.indexOf('NestFactory.create');
  assert.ok(validation >= 0);
  assert.ok(nest > validation);
  assert.match(main, /runtimeEnvironment/);
  assert.match(main, /nodeEnvironment/);
});

test('D integrations reuse global runtime authority instead of a second environment parser', async () => {
  const integration = await source(
    'src/modules/integrations/runtime-environment.service.ts',
  );
  assert.match(integration, /parseIronRuntimeEnvironment/);
  assert.doesNotMatch(integration, /INTEGRATION_ENVIRONMENTS\.includes/);
});

test('D runtime hardening preserves the existing health/metrics service contract', async () => {
  const health = await source('src/health.controller.ts');
  const metrics = await source('src/metrics.controller.ts');
  assert.match(health, /gym-saas-backend/);
  assert.match(metrics, /gym-saas-backend/);
});

test('D runbook does not claim physical homologation and no longer lists trial policy as env authority', async () => {
  const runbook = await source(
    'docs/B5_INFRASTRUCTURE_HOMOLOGATION_RUNBOOK.md',
  );
  assert.match(runbook, /homologação física externa continua pendente/i);
  assert.match(runbook, /IRON_RUNTIME_ENV/);
  assert.doesNotMatch(runbook, /IRON_FIT_TRIAL_PLAN_CODE/);
  assert.doesNotMatch(runbook, /IRON_FIT_TRIAL_DAYS/);
});
