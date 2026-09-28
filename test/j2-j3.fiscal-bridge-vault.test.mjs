import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  FiscalBridgeHttpTransport,
  FiscalBridgeTransportError,
  parseFiscalBridgePublicConfiguration,
} = require(
  '../dist/src/modules/financial/fiscal-bridge.contract.js',
);
const {
  FiscalBridgeDispatchService,
} = require(
  '../dist/src/modules/financial/fiscal-bridge-dispatch.service.js',
);
const {
  FiscalScopeBindingService,
} = require(
  '../dist/src/modules/financial/fiscal-scope-binding.service.js',
);
const {
  IntegrationSecretValue,
} = require(
  '../dist/src/modules/integrations/secrets/integration-secret-vault.port.js',
);

function fiscalRow(overrides = {}) {
  return {
    id: 'fiscal-a',
    gymId: 'gym-a',
    chargeId: 'charge-a',
    transactionId: 'tx-a',
    idempotencyKey: 'iron:charge:charge-a:nfse:v1',
    contractVersion: 'v1',
    hostNamespace: 'fm.iron',
    packId: 'iron',
    useCaseId: 'recurring-membership-billing',
    operationKind: 'recurring_charge',
    documentKind: 'nfse',
    amountMinor: 26900,
    currency: 'BRL',
    paymentMethod: 'PIX',
    settledAt: new Date('2026-09-28T12:00:00.000Z'),
    status: 'PENDING_CAPABILITY',
    capabilityVersion: null,
    bridgeConnectionId: null,
    attemptCount: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    dispatchLeaseOwner: null,
    dispatchLeaseUntil: null,
    lastErrorCode: null,
    createdAt: new Date('2026-09-28T12:00:01.000Z'),
    updatedAt: new Date('2026-09-28T12:00:01.000Z'),
    ...overrides,
  };
}

function fixture({
  row = fiscalRow(),
  capabilityReadiness = 'HOMOLOGATION_READY',
  capabilityList = ['nfse', 'issue'],
  issuanceStatus = 'accepted',
  issuanceError = null,
} = {}) {
  const writes = [];
  const audits = [];
  const posts = [];
  const prisma = {
    integrationConnection: {
      findMany: async () => [
        {
          id: 'fiscal-global-a',
          scope: 'GLOBAL',
          gymId: null,
          providerCode: 'fm-fiscal-core',
          environment: 'HOMOLOG',
          status: 'ACTIVE',
          capabilities: ['fiscal.bridge'],
          publicConfiguration: {
            baseUrl: 'https://fiscal.example.com/',
            workloadId: 'workload-iron-homolog',
          },
          secretReference: 'isv_' + 'A'.repeat(43),
          secretVersion: 1,
          secretRotatedAt: new Date(),
          secretExpiresAt: null,
          secretRevokedAt: null,
          updatedAt: new Date(),
        },
      ],
    },
    fiscalHandoff: {
      findMany: async () => [row],
      updateMany: async ({ where, data }) => {
        writes.push({ where, data });
        return { count: 1 };
      },
    },
  };

  const http = {
    post: async (path, body, context, correlationId, idempotencyKey) => {
      posts.push({ path, body, context, correlationId, idempotencyKey });
      if (path === '/v1/capabilities/query') {
        return {
          readiness: capabilityReadiness,
          capability_version: 'cap-v1',
          capabilities: capabilityList,
          correlation_id: correlationId,
        };
      }
      if (issuanceError) throw issuanceError;
      return {
        request_id: 'fiscal-request-a',
        status: issuanceStatus,
        replay: false,
        correlation_id: correlationId,
        document_id:
          issuanceStatus === 'authorized' ? 'doc-a' : null,
        access_key: null,
        protocol_reference:
          issuanceStatus === 'authorized' ? 'protocol-a' : null,
      };
    },
    parseCapability(payload) {
      return {
        readiness: payload.readiness,
        capabilityVersion: payload.capability_version,
        capabilities: payload.capabilities,
        correlationId: payload.correlation_id,
      };
    },
    parseIssuance(payload) {
      return {
        requestId: payload.request_id,
        status: payload.status,
        replay: payload.replay,
        correlationId: payload.correlation_id,
        documentId: payload.document_id,
        accessKey: payload.access_key,
        protocolReference: payload.protocol_reference,
      };
    },
  };

  const service = new FiscalBridgeDispatchService(
    prisma,
    { current: () => 'HOMOLOG' },
    {
      resolveForExternalBoundary: async (connectionId, scope) => {
        assert.equal(connectionId, 'fiscal-global-a');
        assert.deepEqual(scope, { scope: 'GLOBAL' });
        return new IntegrationSecretValue('vault-workload-secret');
      },
    },
    {
      resolve: async (gymId) => {
        assert.equal(gymId, 'gym-a');
        return {
          externalTenantId: 'iron-tenant-a',
          externalUnitId: 'iron-unit-a',
        };
      },
    },
    http,
    {
      record: async (record) => {
        audits.push(record);
      },
    },
  );

  return { service, writes, audits, posts };
}

test('J2 fiscal scope binding is tenant-derived, environment-scoped and step-up governed', async () => {
  const calls = {
    stepUp: [],
    upserts: [],
    audits: [],
  };
  let current = null;
  const service = new FiscalScopeBindingService(
    {
      fiscalScopeBinding: {
        findUnique: async () => current,
        upsert: async ({ create, update }) => {
          calls.upserts.push({ create, update });
          current = {
            id: 'binding-a',
            ...create,
            ...update,
            updatedAt: new Date('2026-09-28T13:00:00.000Z'),
          };
          return current;
        },
      },
    },
    { current: () => 'HOMOLOG' },
    {
      assertStepUp: async (...args) => {
        calls.stepUp.push(args);
      },
    },
    {
      record: async (record) => {
        calls.audits.push(record);
      },
    },
  );

  const result = await service.upsert(
    'gym-a',
    'owner-a',
    {
      externalTenantId: ' fiscal-tenant-a ',
      externalUnitId: ' fiscal-unit-a ',
      currentPassword: 'OwnerPassword123!',
    },
  );

  assert.equal(calls.stepUp.length, 1);
  assert.equal(calls.stepUp[0][0], 'owner-a');
  assert.equal(calls.upserts[0].create.gymId, 'gym-a');
  assert.equal(calls.upserts[0].create.environment, 'HOMOLOG');
  assert.equal(
    calls.upserts[0].create.externalTenantId,
    'fiscal-tenant-a',
  );
  assert.equal(
    calls.upserts[0].create.externalUnitId,
    'fiscal-unit-a',
  );
  assert.equal(result.gymId, 'gym-a');
  assert.equal(result.environment, 'HOMOLOG');
  assert.equal(calls.audits[0].gymId, 'gym-a');
  assert.equal(
    calls.audits[0].action,
    'FISCAL_SCOPE_BINDING_CREATED',
  );
});

test('J2/J3 parses only HTTPS FM Fiscal public configuration with non-secret workload id', () => {
  const parsed = parseFiscalBridgePublicConfiguration({
    baseUrl: 'https://fiscal.example.com/api/',
    workloadId: 'iron-workload',
  });
  assert.equal(parsed.baseUrl, 'https://fiscal.example.com/api/');
  assert.equal(parsed.workloadId, 'iron-workload');

  assert.throws(
    () =>
      parseFiscalBridgePublicConfiguration({
        baseUrl: 'http://fiscal.example.com',
        workloadId: 'iron-workload',
      }),
    /HTTPS/,
  );
});

test('J2/J3 transport sends S2S Vault secret only in Authorization and canonical scope headers', async () => {
  const transport = new FiscalBridgeHttpTransport();
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          readiness: 'HOMOLOGATION_READY',
          capability_version: 'cap-v1',
          capabilities: ['nfse', 'issue'],
          correlation_id: 'corr-a',
        }),
    };
  };

  try {
    await transport.post(
      '/v1/capabilities/query',
      { document_kind: 'nfse' },
      {
        environment: 'HOMOLOG',
        scope: {
          tenantId: 'tenant-a',
          unitId: 'unit-a',
        },
        configuration: {
          baseUrl: 'https://fiscal.example.com/',
          workloadId: 'workload-a',
        },
        credential: new IntegrationSecretValue('super-secret'),
      },
      'corr-a',
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(
    captured.url,
    'https://fiscal.example.com/v1/capabilities/query',
  );
  assert.equal(
    captured.options.headers.authorization,
    'Bearer super-secret',
  );
  assert.equal(
    captured.options.headers['x-fm-workload-credential-id'],
    'workload-a',
  );
  assert.equal(
    captured.options.headers['x-fm-host-namespace'],
    'fm.iron',
  );
  assert.equal(
    captured.options.headers['x-fm-tenant-id'],
    'tenant-a',
  );
  assert.equal(
    captured.options.headers['x-fm-unit-id'],
    'unit-a',
  );
  assert.equal(
    captured.options.headers['x-fm-environment'],
    'homologation',
  );
});

test('J2 capability gate precedes issuance and uses deterministic idempotency key', async () => {
  const fx = fixture();

  const result = await fx.service.dispatchDue();

  assert.deepEqual(result, { scanned: 1, completed: 1 });
  assert.equal(fx.posts.length, 2);
  assert.equal(fx.posts[0].path, '/v1/capabilities/query');
  assert.deepEqual(fx.posts[0].body, { document_kind: 'nfse' });
  assert.equal(fx.posts[1].path, '/v1/issuances');
  assert.equal(
    fx.posts[1].idempotencyKey,
    'iron:charge:charge-a:nfse:v1',
  );
  assert.equal(
    fx.posts[1].context.credential.toJSON(),
    '[REDACTED]',
  );
  assert.equal(
    fx.posts[1].body.contract_version,
    '1.0.0',
  );
  assert.equal(
    fx.posts[1].body.operation.operation_kind,
    'recurring_charge',
  );
  assert.equal(
    fx.posts[1].body.document.kind,
    'nfse',
  );

  const submitted = fx.writes.find(
    ({ data }) => data.status === 'SUBMITTED',
  );
  assert.ok(submitted);
  assert.equal(
    submitted.data.bridgeConnectionId,
    undefined,
  );
  const ready = fx.writes.find(
    ({ data }) => data.status === 'READY_TO_ISSUE',
  );
  assert.ok(ready);
  assert.equal(
    ready.data.bridgeConnectionId,
    'fiscal-global-a',
  );
  assert.ok(
    fx.audits.some(
      (record) =>
        record.action === 'FISCAL_BRIDGE_ISSUANCE_RESULT',
    ),
  );
});

test('J2 fails closed without readiness and does not issue', async () => {
  const fx = fixture({
    capabilityReadiness: 'CONTRACT_ONLY',
  });

  const result = await fx.service.dispatchDue();

  assert.deepEqual(result, { scanned: 1, completed: 0 });
  assert.equal(fx.posts.length, 1);
  assert.equal(fx.posts[0].path, '/v1/capabilities/query');
  const retry = fx.writes.find(
    ({ data }) =>
      data.lastErrorCode === 'FISCAL_CAPABILITY_NOT_READY',
  );
  assert.ok(retry);
  assert.equal(retry.data.status, 'PENDING_CAPABILITY');
  assert.ok(retry.data.nextAttemptAt instanceof Date);
});

test('J2 unknown issuance outcome is never blindly retried and enters reconciliation', async () => {
  const fx = fixture({
    issuanceError: new FiscalBridgeTransportError(
      'FISCAL_UNAVAILABLE_OR_TIMEOUT',
      true,
    ),
  });

  const result = await fx.service.dispatchDue();

  assert.deepEqual(result, { scanned: 1, completed: 0 });
  assert.equal(fx.posts.length, 2);
  const unknown = fx.writes.find(
    ({ data }) =>
      data.status === 'RECONCILIATION_PENDING',
  );
  assert.ok(unknown);
  assert.equal(unknown.data.nextAttemptAt, null);
  assert.equal(
    unknown.data.bridgeConnectionId,
    'fiscal-global-a',
  );
});

test('J3 source keeps fiscal workload secret out of schema, migration and public binding DTO', async () => {
  const [schema, migration, dto, bootstrap, docs] =
    await Promise.all([
      readFile('prisma/schema.prisma', 'utf8'),
      readFile(
        'prisma/migrations/20260928134000_fiscal_bridge_binding/migration.sql',
        'utf8',
      ),
      readFile(
        'src/modules/financial/dto/upsert-fiscal-scope-binding.dto.ts',
        'utf8',
      ),
      readFile(
        'src/modules/integrations/integration-provider-bootstrap.service.ts',
        'utf8',
      ),
      readFile(
        'docs/J2_J3_FISCAL_BRIDGE_VAULT.md',
        'utf8',
      ),
    ]);

  const bindingBlock = schema.slice(
    schema.indexOf('model FiscalScopeBinding'),
    schema.indexOf('model FiscalHandoff'),
  );
  assert.doesNotMatch(
    bindingBlock,
    /secret|token|password|privateKey|clientSecret|apiKey/i,
  );
  assert.doesNotMatch(
    migration,
    /secretValue|privateKey|clientSecret|apiKey|bearerSecret/i,
  );
  assert.doesNotMatch(
    dto,
    /providerCode|baseUrl|workloadId|secretReference/i,
  );
  assert.match(bootstrap, /providerCode: 'fm-fiscal-core'/);
  assert.match(bootstrap, /capabilities: \['fiscal\.bridge'\]/);
  assert.match(docs, /BLOCKED_EXTERNAL/);
});
