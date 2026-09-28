import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  FiscalReconciliationCancellationService,
} = require(
  '../dist/src/modules/financial/fiscal-reconciliation-cancellation.service.js',
);
const {
  FiscalBridgeTransportError,
} = require(
  '../dist/src/modules/financial/fiscal-bridge.contract.js',
);
const {
  IntegrationSecretValue,
} = require(
  '../dist/src/modules/integrations/secrets/integration-secret-vault.port.js',
);

function context() {
  return {
    environment: 'HOMOLOG',
    scope: {
      tenantId: 'tenant-a',
      unitId: 'unit-a',
    },
    configuration: {
      baseUrl: 'https://fiscal.example.com/',
      workloadId: 'workload-a',
    },
    credential: new IntegrationSecretValue('vault-secret'),
  };
}

function baseRow(overrides = {}) {
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
    status: 'RECONCILIATION_PENDING',
    capabilityVersion: 'cap-v1',
    providerRequestId: null,
    providerDocumentId: null,
    providerAccessKey: null,
    providerProtocolReference: null,
    cancellationRequestId: null,
    cancellationJustification: null,
    cancellationProtocolReference: null,
    cancellationRejectionCode: null,
    cancellationRejectionMessage: null,
    reconciliationFingerprint: null,
    reconciliationIssueCodes: null,
    bridgeConnectionId: 'fiscal-global-a',
    attemptCount: 1,
    nextAttemptAt: null,
    lastAttemptAt: null,
    dispatchLeaseOwner: null,
    dispatchLeaseUntil: null,
    lastErrorCode: null,
    authorizedAt: null,
    cancelledAt: null,
    reconciledAt: null,
    createdAt: new Date('2026-09-28T12:00:01.000Z'),
    updatedAt: new Date('2026-09-28T12:00:01.000Z'),
    ...overrides,
  };
}

function reconciliationFixture({
  row = baseRow(),
  reconciliationStatus = 'matched',
  selectedDocumentId = 'doc-a',
} = {}) {
  const writes = [];
  const posts = [];
  const audits = [];
  const prisma = {
    fiscalHandoff: {
      findMany: async () => [row],
      findFirst: async () => row,
      updateMany: async ({ where, data }) => {
        writes.push({ where, data });
        return { count: 1 };
      },
    },
  };
  const http = {
    post: async (path, body, _context, correlationId, idempotencyKey) => {
      posts.push({ path, body, correlationId, idempotencyKey });
      if (path === '/v1/reconciliations') {
        return {
          status: reconciliationStatus,
          operation_reference: {
            type: 'iron_charge',
            id: row.chargeId,
          },
          fingerprint: 'a'.repeat(64),
          issues:
            reconciliationStatus === 'divergent'
              ? [
                  {
                    code: 'AMOUNT_MISMATCH',
                    message: 'amount mismatch',
                    document_id: selectedDocumentId,
                  },
                ]
              : [],
          selected_document_id: selectedDocumentId,
          correlation_id: correlationId,
        };
      }
      throw new Error('unexpected path ' + path);
    },
    parseReconciliation(payload) {
      return {
        status: payload.status,
        operationReference: {
          type: payload.operation_reference.type,
          id: payload.operation_reference.id,
        },
        fingerprint: payload.fingerprint,
        issues: payload.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          documentId: issue.document_id,
        })),
        selectedDocumentId: payload.selected_document_id,
        correlationId: payload.correlation_id,
      };
    },
  };

  const service = new FiscalReconciliationCancellationService(
    prisma,
    {
      assertStepUp: async () => undefined,
    },
    {
      resolveBridgeContext: async (gymId) => {
        assert.equal(gymId, 'gym-a');
        return {
          connectionId: 'fiscal-global-a',
          context: context(),
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

  return { service, writes, posts, audits };
}

test('J4 reconciliation resolves unknown issuance without repeating issuance call', async () => {
  const fx = reconciliationFixture();

  const result = await fx.service.reconcileDue();

  assert.deepEqual(result, { scanned: 1, reconciled: 1 });
  assert.equal(fx.posts.length, 1);
  assert.equal(fx.posts[0].path, '/v1/reconciliations');
  assert.equal(
    fx.posts[0].idempotencyKey,
    'iron:charge:charge-a:nfse:v1:reconcile',
  );
  assert.equal(
    fx.posts[0].body.operation.operation_reference.type,
    'iron_charge',
  );
  const reconciled = fx.writes.find(
    ({ data }) => data.status === 'RECONCILED',
  );
  assert.ok(reconciled);
  assert.equal(reconciled.data.providerDocumentId, 'doc-a');
  assert.equal(
    reconciled.data.reconciliationFingerprint,
    'a'.repeat(64),
  );
  assert.ok(
    fx.audits.some(
      (record) =>
        record.action === 'FISCAL_RECONCILIATION_MATCHED',
    ),
  );
  assert.equal(
    fx.posts.some((post) => post.path === '/v1/issuances'),
    false,
  );
});

test('J4 divergent reconciliation fails closed and never declares document reconciled', async () => {
  const fx = reconciliationFixture({
    reconciliationStatus: 'divergent',
  });

  const result = await fx.service.reconcileDue();

  assert.deepEqual(result, { scanned: 1, reconciled: 0 });
  const failed = fx.writes.find(
    ({ data }) =>
      data.lastErrorCode ===
      'FISCAL_RECONCILIATION_DIVERGENT',
  );
  assert.ok(failed);
  assert.equal(failed.data.status, 'FAILED');
  assert.deepEqual(
    failed.data.reconciliationIssueCodes,
    ['AMOUNT_MISMATCH'],
  );
});

function cancellationFixture({
  initialRow,
  cancellationStatus = 'accepted',
  queryStatus = 'cancelled',
  cancellationError = null,
} = {}) {
  let row =
    initialRow ??
    baseRow({
      status: 'AUTHORIZED',
      providerDocumentId: 'doc-a',
      providerAccessKey: '1'.repeat(44),
      providerProtocolReference: 'authorization-protocol-a',
      authorizedAt: new Date('2026-09-28T12:10:00.000Z'),
    });
  const writes = [];
  const posts = [];
  const audits = [];
  const stepUps = [];

  const prisma = {
    fiscalHandoff: {
      findFirst: async ({ where }) => {
        if (where.id !== row.id || where.gymId !== row.gymId) return null;
        return { ...row };
      },
      findMany: async () =>
        row.status === 'CANCELLATION_PENDING' ? [{ ...row }] : [],
      updateMany: async ({ data }) => {
        writes.push(data);
        row = { ...row, ...data, updatedAt: new Date() };
        return { count: 1 };
      },
    },
  };

  const http = {
    post: async (path, body, _context, correlationId, idempotencyKey) => {
      posts.push({ path, body, correlationId, idempotencyKey });
      if (path === '/v1/cancellations') {
        if (cancellationError) throw cancellationError;
        return {
          status: cancellationStatus,
          request_id: 'cancel-request-a',
          access_key: '1'.repeat(44),
          correlation_id: correlationId,
          event_protocol_reference:
            cancellationStatus === 'rejected'
              ? null
              : 'cancel-protocol-a',
          rejection_code:
            cancellationStatus === 'rejected'
              ? 'WINDOW_EXPIRED'
              : null,
          rejection_message:
            cancellationStatus === 'rejected'
              ? 'window expired'
              : null,
        };
      }
      if (path === '/v1/queries') {
        return {
          status: queryStatus,
          access_key: '1'.repeat(44),
          protocol_reference:
            queryStatus === 'cancelled'
              ? 'cancelled-protocol-a'
              : 'authorization-protocol-a',
          correlation_id: correlationId,
        };
      }
      throw new Error('unexpected path ' + path);
    },
    parseCancellation(payload) {
      return {
        status: payload.status,
        requestId: payload.request_id,
        accessKey: payload.access_key,
        correlationId: payload.correlation_id,
        eventProtocolReference:
          payload.event_protocol_reference,
        rejectionCode: payload.rejection_code,
        rejectionMessage: payload.rejection_message,
      };
    },
    parseQuery(payload) {
      return {
        status: payload.status,
        accessKey: payload.access_key,
        protocolReference: payload.protocol_reference,
        correlationId: payload.correlation_id,
      };
    },
  };

  const service = new FiscalReconciliationCancellationService(
    prisma,
    {
      assertStepUp: async (...args) => {
        stepUps.push(args);
      },
    },
    {
      resolveBridgeContext: async () => ({
        connectionId: 'fiscal-global-a',
        context: context(),
      }),
    },
    http,
    {
      record: async (record) => {
        audits.push(record);
      },
    },
  );

  return {
    service,
    writes,
    posts,
    audits,
    stepUps,
    getRow: () => row,
  };
}

test('J4 cancellation is explicit step-up action using canonical access key/protocol and deterministic idempotency', async () => {
  const fx = cancellationFixture();

  const result = await fx.service.requestCancellation(
    'fiscal-a',
    'gym-a',
    'owner-a',
    {
      justification:
        'Cancelamento solicitado pelo responsavel da academia.',
      currentPassword: 'OwnerPassword123!',
    },
  );

  assert.equal(fx.stepUps.length, 1);
  assert.equal(fx.stepUps[0][0], 'owner-a');
  assert.equal(result.status, 'CANCELLATION_PENDING');
  assert.equal(fx.posts.length, 1);
  assert.equal(fx.posts[0].path, '/v1/cancellations');
  assert.equal(
    fx.posts[0].idempotencyKey,
    'iron:charge:charge-a:nfse:v1:cancel',
  );
  assert.equal(
    fx.posts[0].body.access_key,
    '1'.repeat(44),
  );
  assert.equal(
    fx.posts[0].body.authorization_protocol,
    'authorization-protocol-a',
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      fx.posts[0].body,
      'gymId',
    ),
    false,
  );
  assert.ok(
    fx.audits.some(
      (record) =>
        record.action === 'FISCAL_CANCELLATION_REQUESTED',
    ),
  );
});

test('J4 unknown cancellation outcome remains pending and is confirmed by query before CANCELLED', async () => {
  const fx = cancellationFixture({
    cancellationError: new FiscalBridgeTransportError(
      'FISCAL_UNAVAILABLE_OR_TIMEOUT',
      true,
    ),
  });

  await assert.rejects(
    () =>
      fx.service.requestCancellation(
        'fiscal-a',
        'gym-a',
        'owner-a',
        {
          justification:
            'Cancelamento solicitado pelo responsavel da academia.',
          currentPassword: 'OwnerPassword123!',
        },
      ),
    /pendente de confirmacao/,
  );

  assert.equal(fx.getRow().status, 'CANCELLATION_PENDING');
  assert.ok(fx.getRow().nextAttemptAt instanceof Date);

  fx.getRow().nextAttemptAt = null;
  fx.getRow().cancellationJustification =
    'Cancelamento solicitado pelo responsavel da academia.';

  const resumed = await fx.service.resumeCancellations();

  assert.deepEqual(resumed, { scanned: 1, cancelled: 1 });
  assert.equal(
    fx.posts.some((post) => post.path === '/v1/queries'),
    true,
  );
  assert.equal(fx.getRow().status, 'CANCELLED');
  assert.ok(fx.getRow().cancelledAt instanceof Date);
});

test('J4 source persists only bounded lifecycle metadata and remains externally blocked', async () => {
  const [schema, migration, serviceSource, docs] =
    await Promise.all([
      readFile('prisma/schema.prisma', 'utf8'),
      readFile(
        'prisma/migrations/20260928141000_fiscal_reconcile_cancel/migration.sql',
        'utf8',
      ),
      readFile(
        'src/modules/financial/fiscal-reconciliation-cancellation.service.ts',
        'utf8',
      ),
      readFile(
        'docs/J4_FISCAL_RECONCILIATION_CANCELLATION.md',
        'utf8',
      ),
    ]);

  const block = schema.slice(
    schema.indexOf('model FiscalHandoff'),
    schema.indexOf('model CommunicationTemplate'),
  );
  assert.match(block, /cancellationJustification/);
  assert.match(block, /reconciliationFingerprint/);
  assert.doesNotMatch(
    block,
    /workloadSecret|privateKey|clientSecret|apiKey/i,
  );
  assert.doesNotMatch(
    migration,
    /workloadSecret|privateKey|clientSecret|apiKey/i,
  );
  assert.match(
    serviceSource,
    /\/v1\/reconciliations/,
  );
  assert.match(
    serviceSource,
    /\/v1\/cancellations/,
  );
  assert.match(serviceSource, /\/v1\/queries/);
  assert.doesNotMatch(
    serviceSource,
    /\/v1\/issuances[\s\S]*resumeCancellation/,
  );
  assert.match(docs, /BLOCKED_EXTERNAL/);
});
