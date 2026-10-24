import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FmCommandControlPlaneService } = require(
  '../dist/src/modules/fm-command/fm-command-control-plane.service.js',
);
const { FmCommandControlPlaneGuard } = require(
  '../dist/src/modules/fm-command/fm-command-control-plane.guard.js',
);

const published = (code = 'IRON_BASIC', version = 1, date = new Date('2026-10-19T12:00:00Z')) => ({
  id: 'published-' + version,
  version,
  publishedAt: date,
  productPlan: { code, name: 'Plano Básico' },
});
function serviceWithRows(rows) {
  const queries = [];
  const prisma = {
    productPlanVersion: {
      findMany: async (args) => {
        queries.push(args);
        return rows;
      },
    },
  };
  return { service: new FmCommandControlPlaneService(prisma, {}, {}), queries };
}

test('S2S C01 provider produces exactly the published-plan catalog consumed by FMCC', async () => {
  const { service, queries } = serviceWithRows([published()]);
  const data = await service.publishedPlanVersions();
  assert.equal(data.schema_version, 'iron.fmcc.plan-versions.v1');
  assert.equal(data.product_code, 'IRON_FIT_CORE');
  assert.equal(data.source_authority, 'IRON_PRODUCT_PLAN_VERSION');
  assert.equal(data.truncated, false);
  assert.ok(Number.isFinite(Date.parse(data.as_of)));
  assert.deepEqual(data.plans, [{
    plan_code: 'IRON_BASIC',
    display_name: 'Plano Básico',
    version: 1,
    published_at: '2026-10-19T12:00:00.000Z',
  }]);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].where.status, 'PUBLISHED');
  assert.equal(queries[0].take, 257);
  assert.deepEqual(queries[0].select, {
    id: true, version: true, publishedAt: true,
    productPlan: { select: { code: true, name: true } },
  });
  const serialized = JSON.stringify(data);
  for (const secret of ['price', 'customer', 'email', 'password', 'secret', 'token']) {
    assert.equal(serialized.includes(secret), false, 'Unexpected provider field: ' + secret);
  }
});

test('S2S C01 provider refuses invalid published rows rather than emitting an FMCC-incompatible payload', async () => {
  const malformed = [
    published('IRON_BASIC', 1, null),
    published('IRON_BASIC', 0),
    published('../OTHER', 1),
    { ...published(), productPlan: { code: 'IRON_BASIC', name: ' ' } },
    [published(), { ...published(), id: 'duplicate-row' }],
    [published('IRON_BASIC', 1), published('IRON_BASIC', 1)],
  ];
  for (const candidate of malformed) {
    const rows = Array.isArray(candidate) ? candidate : [candidate];
    const { service } = serviceWithRows(rows);
    await assert.rejects(
      () => service.publishedPlanVersions(),
      (error) => error.getStatus?.() === 503,
      'published catalog must reject incompatible records',
    );
  }
});

test('S2S C01 truncated catalog is explicit, bounded to 256 and does not mutate persisted rows', async () => {
  const rows = Array.from({ length: 257 }, (_, i) =>
    published('IRON_BASIC', i + 1, new Date('2026-10-19T12:00:00Z')));
  const { service } = serviceWithRows(rows);
  const catalog = await service.publishedPlanVersions();
  assert.equal(catalog.truncated, true);
  assert.equal(catalog.plans.length, 256);
  assert.equal(catalog.plans[255].version, 256);
  assert.equal(rows.length, 257);
});

test('S2S C01 guard accepts only configured server token and valid correlation ID', () => {
  const previous = process.env.FMCC_IRON_CONTROL_PLANE_TOKEN;
  const token = 'ci-fmcc-iron-control-plane-token-' + 'x'.repeat(48);
  const guard = new FmCommandControlPlaneGuard();
  const request = (headers) => ({ headers });
  const activate = (req) => guard.canActivate({
    switchToHttp: () => ({ getRequest: () => req }),
  });
  try {
    process.env.FMCC_IRON_CONTROL_PLANE_TOKEN = token;
    const valid = request({
      authorization: 'Bearer ' + token, 'x-correlation-id': 'ci-c01-123',
    });
    assert.equal(activate(valid), true);
    assert.equal(valid.fmCommandCorrelationId, 'ci-c01-123');

    for (const authorization of [undefined, 'Basic ' + token, 'Bearer wrong', 'Bearer ']) {
      assert.throws(() => activate(request({
        authorization, 'x-correlation-id': 'ci-c01-123',
      })), (e) => e.getStatus?.() === 401);
    }
    for (const correlationId of ['', 'z'.repeat(129)]) {
      assert.throws(() => activate(request({
        authorization: 'Bearer ' + token, 'x-correlation-id': correlationId,
      })), (e) => e.getStatus?.() === 401);
    }
    delete process.env.FMCC_IRON_CONTROL_PLANE_TOKEN;
    assert.throws(() => activate(valid), (e) => e.getStatus?.() === 503);
  } finally {
    if (previous === undefined) delete process.env.FMCC_IRON_CONTROL_PLANE_TOKEN;
    else process.env.FMCC_IRON_CONTROL_PLANE_TOKEN = previous;
  }
});
