import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  CommunicationDispatchService,
} = require(
  '../dist/src/modules/communication/communication-dispatch.service.js',
);
const {
  CommunicationDispatchFailure,
  MetaWhatsAppCommunicationAdapter,
} = require(
  '../dist/src/modules/communication/communication-dispatch-adapter.js',
);
const {
  IntegrationSecretValue,
} = require(
  '../dist/src/modules/integrations/secrets/integration-secret-vault.port.js',
);

function oauthBundle() {
  return JSON.stringify({
    schemaVersion: 1,
    providerCode: 'meta',
    accessToken: 'tenant-access-secret',
    refreshToken: null,
    tokenType: 'Bearer',
    grantedScopes: ['whatsapp_business_messaging'],
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    accessExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
}

function messageFixture(overrides = {}) {
  return {
    id: 'message-a',
    gymId: 'gym-a',
    studentId: 'student-a',
    templateId: null,
    channel: 'WHATSAPP',
    status: 'SENDING',
    title: null,
    body: 'Treino confirmado',
    dispatchKey: 'dispatch-key-a',
    attemptCount: 1,
    dispatchLeaseOwner: 'lease-placeholder',
    student: {
      status: 'ACTIVE',
      consentComm: true,
      user: { phone: '+55 11 99999-9999' },
      communicationPreference: { whatsappEnabled: true },
    },
    ...overrides,
  };
}

test('I6 dispatch claims QUEUED message, resolves canonical tenant connection and records sanitized SENT result', async () => {
  let leaseOwner;
  let finalized;
  let connectionWhere;
  let dispatchInput;
  const audits = [];
  const message = messageFixture();

  const prisma = {
    communicationMessage: {
      updateMany: async ({ data }) => {
        if (data.status === 'SENDING') {
          leaseOwner = data.dispatchLeaseOwner;
          return { count: 1 };
        }
        finalized = data;
        return { count: 1 };
      },
      findUnique: async () => ({
        ...message,
        dispatchLeaseOwner: leaseOwner,
      }),
    },
    integrationConnection: {
      findMany: async ({ where }) => {
        connectionWhere = where;
        return [
          {
            id: 'connection-meta-a',
            gymId: 'gym-a',
            providerCode: 'meta',
            environment: 'HOMOLOG',
            authModel: 'OAUTH2',
            status: 'ACTIVE',
            capabilities: ['meta.whatsapp'],
            publicConfiguration: {
              whatsappMessagesEndpoint:
                'https://graph.example.com/messages',
            },
          },
        ];
      },
    },
  };

  const service = new CommunicationDispatchService(
    prisma,
    {
      require: () => ({
        dispatch: async (input) => {
          dispatchInput = input;
          return { providerMessageRef: 'provider-message-a' };
        },
      }),
    },
    { current: () => 'HOMOLOG' },
    {
      resolveForExternalBoundary: async (connectionId, scope) => {
        assert.equal(connectionId, 'connection-meta-a');
        assert.deepEqual(scope, { scope: 'TENANT', gymId: 'gym-a' });
        return new IntegrationSecretValue(oauthBundle());
      },
    },
    { record: async (record) => audits.push(record) },
  );

  const result = await service.dispatchOne(message.id);

  assert.equal(result.dispatched, true);
  assert.equal(result.status, 'SENT');
  assert.equal(connectionWhere.gymId, 'gym-a');
  assert.equal(connectionWhere.scope, 'TENANT');
  assert.equal(connectionWhere.providerCode, 'meta');
  assert.equal(connectionWhere.environment, 'HOMOLOG');
  assert.equal(dispatchInput.dispatchKey, 'dispatch-key-a');
  assert.equal(dispatchInput.recipient, '+55 11 99999-9999');
  assert.equal(dispatchInput.credential.toJSON(), '[REDACTED]');

  assert.equal(finalized.status, 'SENT');
  assert.equal(finalized.providerCode, 'meta');
  assert.equal(finalized.providerConnectionId, 'connection-meta-a');
  assert.equal(finalized.providerMessageRef, 'provider-message-a');
  assert.equal(finalized.dispatchLeaseOwner, null);
  assert.equal(finalized.lastErrorCode, null);

  const persisted = JSON.stringify(finalized);
  const auditJson = JSON.stringify(audits);
  assert.doesNotMatch(persisted, /tenant-access-secret/);
  assert.doesNotMatch(auditJson, /tenant-access-secret/);
});

test('I6 duplicate worker cannot dispatch when durable lease acquisition fails', async () => {
  let adapterCalled = false;
  const service = new CommunicationDispatchService(
    {
      communicationMessage: {
        updateMany: async () => ({ count: 0 }),
      },
    },
    {
      require: () => ({
        dispatch: async () => {
          adapterCalled = true;
          return {};
        },
      }),
    },
    { current: () => 'HOMOLOG' },
    {},
    { record: async () => undefined },
  );

  const result = await service.dispatchOne('message-a');
  assert.equal(result.dispatched, false);
  assert.equal(result.reason, 'NOT_DUE_OR_LOCKED');
  assert.equal(adapterCalled, false);
});

test('I6 communication consent and WhatsApp preference fail closed before provider resolution', async () => {
  let leaseOwner;
  let providerResolved = false;
  let failedData;
  const message = messageFixture({
    student: {
      status: 'ACTIVE',
      consentComm: false,
      user: { phone: '+5511999999999' },
      communicationPreference: { whatsappEnabled: true },
    },
  });

  const service = new CommunicationDispatchService(
    {
      communicationMessage: {
        updateMany: async ({ data }) => {
          if (data.status === 'SENDING') {
            leaseOwner = data.dispatchLeaseOwner;
            return { count: 1 };
          }
          failedData = data;
          return { count: 1 };
        },
        findUnique: async () => ({
          ...message,
          dispatchLeaseOwner: leaseOwner,
        }),
      },
      integrationConnection: {
        findMany: async () => {
          providerResolved = true;
          return [];
        },
      },
    },
    { require: () => ({}) },
    { current: () => 'HOMOLOG' },
    {},
    { record: async () => undefined },
  );

  const result = await service.dispatchOne(message.id);
  assert.equal(result.dispatched, false);
  assert.equal(result.reason, 'COMMUNICATION_CONSENT_REQUIRED');
  assert.equal(providerResolved, false);
  assert.equal(failedData.status, 'FAILED');
  assert.equal(failedData.lastErrorCode, 'COMMUNICATION_CONSENT_REQUIRED');
  assert.ok(failedData.nextAttemptAt instanceof Date);
});

test('C06 revoked or suspended membership blocks provider dispatch even if message was already queued', async () => {
  for (const status of ['INACTIVE', 'SUSPENDED']) {
    let leaseOwner;
    let finalState;
    let providerResolved = false;
    const message = messageFixture({
      student: {
        status, consentComm: true,
        user: { phone: '+5511999999999' },
        communicationPreference: { whatsappEnabled: true },
      },
    });
    const service = new CommunicationDispatchService(
      {
        communicationMessage: {
          updateMany: async ({ data }) => {
            if (data.status === 'SENDING') {
              leaseOwner = data.dispatchLeaseOwner;
              return { count: 1 };
            }
            finalState = data;
            return { count: 1 };
          },
          findUnique: async () => ({ ...message, dispatchLeaseOwner: leaseOwner }),
        },
        integrationConnection: {
          findMany: async () => {
            providerResolved = true;
            return [];
          },
        },
      },
      { require: () => { throw new Error('adapter reached'); } },
      { current: () => 'HOMOLOG' },
      { resolveForExternalBoundary: async () => { throw new Error('secret reached'); } },
      { record: async () => undefined },
    );
    const result = await service.dispatchOne(message.id);
    assert.equal(result.dispatched, false);
    assert.equal(result.reason, 'STUDENT_INACTIVE');
    assert.equal(providerResolved, false);
    assert.equal(finalState.status, 'FAILED');
    assert.equal(finalState.lastErrorCode, 'STUDENT_INACTIVE');
  }
});

test('I6 ambiguous Meta tenant connections fail closed instead of selecting a tenant authority arbitrarily', async () => {
  let leaseOwner;
  let failedData;
  const message = messageFixture();

  const service = new CommunicationDispatchService(
    {
      communicationMessage: {
        updateMany: async ({ data }) => {
          if (data.status === 'SENDING') {
            leaseOwner = data.dispatchLeaseOwner;
            return { count: 1 };
          }
          failedData = data;
          return { count: 1 };
        },
        findUnique: async () => ({
          ...message,
          dispatchLeaseOwner: leaseOwner,
        }),
      },
      integrationConnection: {
        findMany: async () => [
          { id: 'a', capabilities: ['meta.whatsapp'] },
          { id: 'b', capabilities: ['meta.whatsapp'] },
        ],
      },
    },
    { require: () => ({}) },
    { current: () => 'HOMOLOG' },
    {},
    { record: async () => undefined },
  );

  const result = await service.dispatchOne(message.id);
  assert.equal(result.dispatched, false);
  assert.equal(result.reason, 'PROVIDER_CONNECTION_AMBIGUOUS');
  assert.equal(failedData.lastErrorCode, 'PROVIDER_CONNECTION_AMBIGUOUS');
});

test('I6 Meta WhatsApp adapter sends only bearer credential at external boundary and sanitizes provider errors', async () => {
  const originalFetch = globalThis.fetch;
  const observed = [];
  globalThis.fetch = async (url, init) => {
    observed.push({ url: String(url), init });
    return new Response(
      JSON.stringify({ messages: [{ id: 'wamid.test' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    const adapter = new MetaWhatsAppCommunicationAdapter();
    const result = await adapter.dispatch({
      dispatchKey: 'dispatch-a',
      recipient: '+55 (11) 99999-9999',
      title: null,
      body: 'Mensagem segura',
      publicConfiguration: {
        whatsappMessagesEndpoint:
          'https://graph.example.com/v1/messages',
      },
      credential: new IntegrationSecretValue('meta-access-secret'),
    });

    assert.equal(result.providerMessageRef, 'wamid.test');
    assert.equal(observed.length, 1);
    assert.equal(
      observed[0].init.headers.authorization,
      'Bearer meta-access-secret',
    );
    const payload = JSON.parse(observed[0].init.body);
    assert.equal(payload.to, '5511999999999');
    assert.equal(payload.messaging_product, 'whatsapp');
    assert.equal(payload.text.body, 'Mensagem segura');
  } finally {
    globalThis.fetch = originalFetch;
  }

  await assert.rejects(
    () =>
      new MetaWhatsAppCommunicationAdapter().dispatch({
        dispatchKey: 'dispatch-a',
        recipient: '123',
        title: null,
        body: 'x',
        publicConfiguration: {
          whatsappMessagesEndpoint:
            'https://graph.example.com/v1/messages',
        },
        credential: new IntegrationSecretValue('secret'),
      }),
    (error) =>
      error instanceof CommunicationDispatchFailure &&
      error.code === 'RECIPIENT_PHONE_INVALID',
  );
});

test('I6 persistence has durable idempotency/lease/provider binding without credential columns', async () => {
  const [schema, migration, serviceSource] = await Promise.all([
    readFile('prisma/schema.prisma', 'utf8'),
    readFile(
      'prisma/migrations/20260928111000_communication_dispatch_boundary/migration.sql',
      'utf8',
    ),
    readFile(
      'src/modules/communication/communication-dispatch.service.ts',
      'utf8',
    ),
  ]);

  assert.match(schema, /dispatchKey\s+String\s+@unique/);
  assert.match(schema, /providerConnectionId\s+String\?/);
  assert.match(schema, /dispatchLeaseOwner\s+String\?/);
  assert.match(migration, /CommunicationMessage_dispatchKey_key/);
  assert.match(migration, /providerConnectionId_fkey/);
  assert.doesNotMatch(
    migration,
    /accessToken|refreshToken|clientSecret|authorizationCode/,
  );
  assert.match(serviceSource, /scope: IntegrationScope\.TENANT/);
  assert.match(serviceSource, /gymId/);
  assert.match(serviceSource, /PROVIDER_CONNECTION_AMBIGUOUS/);
});
