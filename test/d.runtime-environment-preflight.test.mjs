import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

function base(overrides = {}) {
  return {
    NODE_ENV: 'development',
    IRON_RUNTIME_ENV: 'DEV',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iron',
    ...overrides,
  };
}

test('D runtime contract accepts explicit DEV without production-only infrastructure', () => {
  const { assertRuntimeStartupConfiguration } = require(
    '../dist/src/config/runtime-environment.js',
  );
  const identity = assertRuntimeStartupConfiguration(base());
  assert.equal(identity.runtimeEnvironment, 'DEV');
  assert.equal(identity.service, 'gym-saas-backend');
});

test('D runtime contract rejects invalid/missing environment authority', () => {
  const { assertRuntimeStartupConfiguration } = require(
    '../dist/src/config/runtime-environment.js',
  );
  assert.throws(
    () => assertRuntimeStartupConfiguration({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost/iron',
    }),
    /IRON_RUNTIME_ENV/,
  );
  assert.throws(
    () => assertRuntimeStartupConfiguration(base({ IRON_RUNTIME_ENV: 'STAGE' })),
    /DEV, HOMOLOG ou PROD/,
  );
});

test('D production-shaped HOMOLOG requires build identity, HTTPS surfaces and protected metrics', () => {
  const { assertRuntimeStartupConfiguration } = require(
    '../dist/src/config/runtime-environment.js',
  );

  const valid = base({
    NODE_ENV: 'production',
    IRON_RUNTIME_ENV: 'HOMOLOG',
    IRON_BUILD_SHA: 'abcdef0123456789',
    WEB_APP_URL: 'https://homolog.iron.example',
    CORS_ORIGINS:
      'https://homolog.iron.example,https://admin-homolog.iron.example',
    OBSERVABILITY_METRICS_TOKEN: 'm'.repeat(48),
  });
  const result = assertRuntimeStartupConfiguration(valid);
  assert.equal(result.runtimeEnvironment, 'HOMOLOG');
  assert.equal(result.buildSha, 'abcdef0123456789');

  for (const broken of [
    { ...valid, IRON_BUILD_SHA: '' },
    { ...valid, WEB_APP_URL: 'http://homolog.iron.example' },
    { ...valid, CORS_ORIGINS: 'http://homolog.iron.example' },
    { ...valid, OBSERVABILITY_METRICS_TOKEN: 'short' },
  ]) {
    assert.throws(() => assertRuntimeStartupConfiguration(broken));
  }
});

test('D PROD refuses non-production node mode, disabled Vault and billing sandbox', () => {
  const { assertRuntimeStartupConfiguration } = require(
    '../dist/src/config/runtime-environment.js',
  );

  const validProd = base({
    NODE_ENV: 'production',
    IRON_RUNTIME_ENV: 'PROD',
    IRON_BUILD_SHA: '0123456789abcdef',
    WEB_APP_URL: 'https://app.iron.example',
    CORS_ORIGINS: 'https://app.iron.example',
    OBSERVABILITY_METRICS_TOKEN: 'o'.repeat(48),
    INTEGRATION_SECRET_VAULT_BACKEND: 'OCI',
    SAAS_BILLING_PROVIDER: 'REAL_PROVIDER_PENDING_ADAPTER',
    SAAS_BILLING_SANDBOX_ENABLED: 'false',
  });

  assert.doesNotThrow(() => assertRuntimeStartupConfiguration(validProd));
  assert.throws(
    () => assertRuntimeStartupConfiguration({
      ...validProd,
      NODE_ENV: 'development',
    }),
    /NODE_ENV=production/,
  );
  assert.throws(
    () => assertRuntimeStartupConfiguration({
      ...validProd,
      INTEGRATION_SECRET_VAULT_BACKEND: 'DISABLED',
    }),
    /INTEGRATION_SECRET_VAULT_BACKEND=OCI/,
  );
  assert.throws(
    () => assertRuntimeStartupConfiguration({
      ...validProd,
      SAAS_BILLING_PROVIDER: 'INTERNAL_SANDBOX',
    }),
    /INTERNAL_SANDBOX/,
  );
  assert.throws(
    () => assertRuntimeStartupConfiguration({
      ...validProd,
      SAAS_BILLING_SANDBOX_ENABLED: 'true',
    }),
    /proibido em PROD/,
  );
});

test('D preflight executes before Nest application creation', async () => {
  const source = await readFile('src/main.ts', 'utf8');
  const preflight = source.indexOf('assertRuntimeStartupConfiguration()');
  const create = source.indexOf('NestFactory.create');
  assert.ok(preflight >= 0);
  assert.ok(create > preflight);
});

test('D health and request logs expose safe build identity without tenant/user or request secrets', async () => {
  const health = await readFile('src/health.controller.ts', 'utf8');
  const metrics = await readFile('src/metrics.controller.ts', 'utf8');
  const middleware = await readFile(
    'src/common/middleware/request-observability.middleware.ts',
    'utf8',
  );

  for (const source of [health, metrics, middleware]) {
    assert.match(source, /runtimeEnvironment/);
    assert.match(source, /buildSha/);
  }
  assert.match(metrics, /MetricsAccessGuard/);
  assert.doesNotMatch(metrics, /gymId|userId/);
  assert.doesNotMatch(middleware, /req\.body|authorization|cookie/i);
});

test('D production metrics guard uses bearer token and constant-time comparison without logging token', async () => {
  const guard = await readFile(
    'src/common/guards/metrics-access.guard.ts',
    'utf8',
  );
  assert.match(guard, /timingSafeEqual/);
  assert.match(guard, /Bearer /);
  assert.match(guard, /OBSERVABILITY_METRICS_TOKEN/);
  assert.doesNotMatch(guard, /console\.|Logger\(/);
});

test('D env example documents runtime identity and keeps observability secret blank', async () => {
  const env = await readFile('.env.example', 'utf8');
  assert.match(env, /IRON_RUNTIME_ENV=DEV/);
  assert.match(env, /IRON_BUILD_SHA=/);
  assert.match(env, /CORS_ORIGINS=http:\/\/localhost:3000/);
  assert.match(env, /OBSERVABILITY_METRICS_TOKEN=/);
  assert.doesNotMatch(
    env,
    /OBSERVABILITY_METRICS_TOKEN=[A-Za-z0-9_-]{32,}/,
  );
});


test('D keeps canonical health metadata backward-compatible while adding safe runtime identity', async () => {
  const { HealthController } = require('../dist/src/health.controller.js');
  const previousRuntime = process.env.IRON_RUNTIME_ENV;
  process.env.IRON_RUNTIME_ENV = 'DEV';
  try {
    const result = new HealthController().check();
    assert.equal(result.status, 'ok');
    assert.equal(result.service, 'gym-saas-backend');
    assert.equal(result.version, '0.1.0');
    assert.equal(result.runtimeEnvironment, 'DEV');
    assert.ok(typeof result.buildSha === 'string');
  } finally {
    if (previousRuntime === undefined) delete process.env.IRON_RUNTIME_ENV;
    else process.env.IRON_RUNTIME_ENV = previousRuntime;
  }
});

test('D CI masks every generated E2E credential before persisting it to runner environment', async () => {
  const workflow = await readFile(
    '.github/workflows/iron-s0-quality.yml',
    'utf8',
  );
  const start = workflow.indexOf('- name: Generate isolated E2E credentials');
  const end = workflow.indexOf('- name: Dependency audit', start);
  const block = workflow.slice(start, end);

  assert.match(block, /mask_and_export/);
  assert.match(block, /::add-mask::\$value/);
  for (const key of [
    'JWT_SECRET',
    'MFA_ENCRYPTION_KEY',
    'AUTH_ACTION_TOKEN_ENCRYPTION_KEY',
    'SAAS_BILLING_SANDBOX_SECRET',
    'B6_OWNER_PASSWORD',
    'B6_STAFF_PASSWORD',
    'B6_STUDENT_PASSWORD',
    'B6_RESET_PASSWORD',
    'B6_ADMIN_PASSWORD',
  ]) {
    assert.match(block, new RegExp('mask_and_export ' + key));
  }
  assert.doesNotMatch(block, /echo "JWT_SECRET=\$\(openssl/);
});
