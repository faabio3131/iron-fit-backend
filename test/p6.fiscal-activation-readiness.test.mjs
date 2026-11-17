import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { NotFoundException } = require('@nestjs/common');
const {
  FiscalBridgeDispatchService,
} = require('../dist/src/modules/financial/fiscal-bridge-dispatch.service.js');

function fixture({
  environment = 'HOMOLOG',
  bindingPresent = true,
  bridgeConfigured = true,
  capabilityReadiness = 'HOMOLOGATION_READY',
  capabilities = ['nfse', 'issue'],
  queryFails = false,
} = {}) {
  const calls = [];
  const bindings = {
    resolve: async (gymId) => {
      calls.push({ kind: 'binding', gymId });
      if (!bindingPresent) throw new NotFoundException('not configured');
      return { externalTenantId: 'tenant-private', externalUnitId: 'unit-private' };
    },
  };
  const transport = {
    post: async (path, payload, context, correlationId) => {
      calls.push({ kind: 'bridge', path, payload, context, correlationId });
      if (queryFails) throw new Error('secret=DO_NOT_EXPOSE');
      return {
        readiness: capabilityReadiness,
        capability_version: 'version-1',
        capabilities,
        correlation_id: correlationId,
      };
    },
    parseCapability: (response) => ({
      readiness: response.readiness,
      capabilityVersion: response.capability_version,
      capabilities: response.capabilities,
      correlationId: response.correlation_id,
    }),
  };
  const service = new FiscalBridgeDispatchService(
    {},
    { current: () => environment },
    {},
    bindings,
    transport,
    {},
  );
  service.resolveBridgeContext = async (gymId) => {
    calls.push({ kind: 'context', gymId });
    if (!bridgeConfigured) throw new Error('secret=DO_NOT_EXPOSE');
    return {
      connectionId: 'internal-private',
      context: {
        environment,
        scope: { tenantId: 'tenant-private', unitId: 'unit-private' },
        configuration: { baseUrl: 'https://private.fiscal.test/', workloadId: 'private-workload' },
        credential: { reveal: () => 'DO_NOT_EXPOSE' },
      },
    };
  };
  return { service, calls };
}

test('P6 does not contact NFCore when canonical gym binding is absent', async () => {
  const fx = fixture({ bindingPresent: false });
  const response = await fx.service.inspectActivationReadiness('gym-a');
  assert.equal(response.status, 'SCOPE_BINDING_REQUIRED');
  assert.equal(response.bindingConfigured, false);
  assert.equal(response.bridgeReachable, false);
  assert.equal(response.certificateStatus, 'NOT_VERIFIED');
  assert.equal(response.municipalityStatus, 'NOT_VERIFIED');
  assert.deepEqual(fx.calls, [{ kind: 'binding', gymId: 'gym-a' }]);
});

test('P6 reports unavailable bridge without leaking credentials or cross-tenant IDs', async () => {
  const fx = fixture({ bridgeConfigured: false });
  const response = await fx.service.inspectActivationReadiness('gym-a');
  assert.equal(response.status, 'BRIDGE_UNAVAILABLE');
  assert.equal(response.bindingConfigured, true);
  assert.equal(response.bridgeReachable, false);
  assert.doesNotMatch(JSON.stringify(response), /secret|tenant-private|unit-private|private-workload/i);
  assert.equal(fx.calls.some((call) => call.kind === 'bridge'), false);
});

test('P6 only reads external NFCore capabilities and never claims A1 or municipality proof', async () => {
  const fx = fixture();
  const response = await fx.service.inspectActivationReadiness('gym-a');
  assert.equal(response.status, 'CAPABILITY_READY');
  assert.equal(response.bindingConfigured, true);
  assert.equal(response.bridgeReachable, true);
  assert.equal(response.capabilityReadiness, 'HOMOLOGATION_READY');
  assert.equal(response.capabilityVersion, 'version-1');
  assert.equal(response.certificateStatus, 'NOT_VERIFIED');
  assert.equal(response.municipalityStatus, 'NOT_VERIFIED');
  assert.match(response.checkedAt, /^\d{4}-\d\d-\d\dT/);
  const bridge = fx.calls.find((call) => call.kind === 'bridge');
  assert.equal(bridge.path, '/v1/capabilities/query');
  assert.deepEqual(bridge.payload, { document_kind: 'nfse' });
  assert.equal(bridge.context.scope.tenantId, 'tenant-private');
  assert.equal(bridge.context.scope.unitId, 'unit-private');
  assert.doesNotMatch(JSON.stringify(response), /DO_NOT_EXPOSE|tenant-private|unit-private|private-workload/);
});

test('P6 production rejects homolog-only readiness and requires both nfse and issue', async () => {
  const prod = fixture({ environment: 'PROD' });
  assert.equal((await prod.service.inspectActivationReadiness('gym-b')).status, 'CAPABILITY_NOT_READY');
  const missing = fixture({ capabilityReadiness: 'PRODUCTION_APPROVED', capabilities: ['nfse'] });
  assert.equal((await missing.service.inspectActivationReadiness('gym-a')).status, 'CAPABILITY_NOT_READY');
  const ready = fixture({ environment: 'PROD', capabilityReadiness: 'PRODUCTION_APPROVED' });
  assert.equal((await ready.service.inspectActivationReadiness('gym-a')).status, 'CAPABILITY_READY');
});

test('P6 failed or malformed remote capability lookup is fail-closed and secret-free', async () => {
  const fx = fixture({ queryFails: true });
  const response = await fx.service.inspectActivationReadiness('gym-a');
  assert.equal(response.status, 'CAPABILITY_UNAVAILABLE');
  assert.equal(response.bridgeReachable, false);
  assert.equal(response.capabilityReadiness, null);
  assert.doesNotMatch(JSON.stringify(response), /DO_NOT_EXPOSE|secret|private/i);
});

test('P6 status API retains financial OWNER/SUPER_ADMIN guards and canonical gym scope', async () => {
  const controller = await readFile(
    new URL('../src/modules/financial/financial.controller.ts', import.meta.url),
    'utf8',
  );
  assert.match(controller, /@UseGuards\(JwtAuthGuard, RolesGuard, StepUpGuard\)/);
  assert.match(controller, /@Get\('fiscal\/readiness'\)\s*@Roles\('SUPER_ADMIN', 'OWNER'\)/);
  assert.match(
    controller,
    /fiscalActivationReadiness\([\s\S]*?this\.fiscalBridgeDispatch\.inspectActivationReadiness\(\s*this\.resolveGymId\(user, requestedGymId\)/,
  );
});

test('P6 operational usage counts only confirmed per-tenant handoffs in the UTC month', async () => {
  const { FiscalReconciliationCancellationService } = require(
    '../dist/src/modules/financial/fiscal-reconciliation-cancellation.service.js',
  );
  const queries = [];
  const service = new FiscalReconciliationCancellationService(
    {
      fiscalHandoff: {
        count: async (args) => {
          queries.push(args);
          return queries.length === 1 ? 4 : 1;
        },
      },
    },
    {},
    {},
    {},
    {},
  );
  const result = await service.getTenantOperationalUsage(
    'gym-canonical',
    new Date('2026-11-16T12:00:00Z'),
  );
  assert.deepEqual(result, {
    periodStart: '2026-11-01T00:00:00.000Z',
    periodEndExclusive: '2026-12-01T00:00:00.000Z',
    timezone: 'UTC',
    authorizedCount: 4,
    cancelledCount: 1,
    source: 'IRON_FISCAL_HANDOFF',
    billingStatus: 'NOT_A_COMMERCIAL_METER',
  });
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].where, {
    gymId: 'gym-canonical',
    authorizedAt: {
      gte: new Date('2026-11-01T00:00:00.000Z'),
      lt: new Date('2026-12-01T00:00:00.000Z'),
    },
  });
  assert.deepEqual(queries[1].where, {
    gymId: 'gym-canonical',
    cancelledAt: {
      gte: new Date('2026-11-01T00:00:00.000Z'),
      lt: new Date('2026-12-01T00:00:00.000Z'),
    },
  });
  assert.equal(JSON.stringify(result).includes('gym-canonical'), false);
});

test('P6 usage endpoint is OWNER/SUPER_ADMIN and always derives tenant from auth', async () => {
  const controller = await readFile(
    new URL('../src/modules/financial/financial.controller.ts', import.meta.url),
    'utf8',
  );
  assert.match(controller, /@Get\\('fiscal\\/usage'\\)\\s*@Roles\\('SUPER_ADMIN', 'OWNER'\\)/);
  assert.match(
    controller,
    /fiscalOperationalUsage\\([\\s\\S]*?this\\.fiscalLifecycle\\.getTenantOperationalUsage\\(\\s*this\\.resolveGymId\\(user, requestedGymId\\)/,
  );
});
