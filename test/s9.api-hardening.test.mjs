import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function mockHost(url = '/api/v1/test') {
  const snapshot = { status: null, body: null };
  const response = {
    status(code) {
      snapshot.status = code;
      return this;
    },
    json(body) {
      snapshot.body = body;
      return this;
    },
  };
  return {
    snapshot,
    host: {
      switchToHttp() {
        return {
          getResponse: () => response,
          getRequest: () => ({ url }),
        };
      },
    },
  };
}

test('S9 bootstrap enables Helmet, strict validation, payload limits and CORS allowlist', async () => {
  const source = await readFile('src/main.ts', 'utf8');
  assert.equal(source.includes("import helmet = require('helmet')"), true);
  assert.equal(source.includes('app.use(helmet())'), true);
  assert.equal(source.includes('CORS_ORIGINS obrigatorio em producao'), true);
  assert.equal(source.includes('whitelist: true'), true);
  assert.equal(source.includes('forbidNonWhitelisted: true'), true);
  assert.equal(source.includes('forbidUnknownValues: true'), true);
  assert.equal(source.includes("app.useBodyParser('json', { limit: '1mb' })"), true);
  assert.equal(source.includes("app.useBodyParser('urlencoded', { limit: '256kb'"), true);
  assert.equal(source.includes('app.enableCors();'), false);
});

test('S9 production exception filter hides internal 500 error details', () => {
  const { ProductionExceptionFilter } = require('../dist/src/common/filters/production-exception.filter.js');
  const { snapshot, host } = mockHost();
  new ProductionExceptionFilter().catch(new Error('database password leaked'), host);
  assert.equal(snapshot.status, 500);
  assert.equal(snapshot.body.message, 'Erro interno do servidor');
  assert.equal(JSON.stringify(snapshot.body).includes('database password leaked'), false);
  assert.equal('stack' in snapshot.body, false);
});

test('S9 high severity npm audit is a permanent quality gate', async () => {
  const workflow = await readFile('.github/workflows/iron-s0-quality.yml', 'utf8');
  assert.equal(workflow.includes('npm audit --audit-level=high'), true);
});

test('S9 Helmet is pinned in runtime dependencies', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.dependencies.helmet, '8.1.0');
});
