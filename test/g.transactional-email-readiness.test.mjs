import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  TransactionalEmailDispatchService,
} = require(
  '../dist/src/modules/transactional-email/transactional-email-dispatch.service.js',
);
const {
  TransactionalEmailProviderAdapterRegistry,
} = require(
  '../dist/src/modules/transactional-email/transactional-email-provider-adapter.js',
);
const {
  IntegrationSecretValue,
} = require(
  '../dist/src/modules/integrations/secrets/integration-secret-vault.port.js',
);
const {
  encryptActionSecret,
} = require('../dist/src/modules/auth/auth-security.js');

function makeConfig() {
  const values = {
    AUTH_ACTION_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    WEB_APP_URL: 'https://iron.example.com',
    TRANSACTIONAL_EMAIL_DISPATCH_ENABLED: 'false',
  };
  return {
    get: (name) => values[name],
  };
}

function makeRow(overrides = {}) {
  const config = makeConfig();
  return {
    config,
    row: {
      id: 'action-a',
      userId: 'user-a',
      kind: 'PASSWORD_RESET',
      deliveryCiphertext: encryptActionSecret(config, 'raw-action-token'),
      deliveryStatus: 'PENDING',
      deliveryAttemptCount: 0,
      deliveryNextAttemptAt: null,
      deliveryLeaseOwner: null,
      deliveryLeaseUntil: null,
      targetEmail: null,
      expiresAt: new Date(Date.now() + 30 * 60_000),
      consumedAt: null,
      createdAt: new Date(),
      user: {
        email: 'owner@example.com',
        active: true,
      },
      ...overrides,
    },
  };
}

function fixture({ connections, rowOverrides = {}, providerDispatch } = {}) {
  const { config, row } = makeRow(rowOverrides);
  const captured = {
    writes: [],
    audits: [],
    dispatches: [],
  };

  const providerConnections =
    connections ??
    [
      {
        id: 'email-global-a',
        scope: 'GLOBAL',
        gymId: null,
        providerCode: 'fake-mail',
        environment: 'HOMOLOG',
        status: 'ACTIVE',
        capabilities: ['email.transactional'],
        publicConfiguration: {
          senderDomain: 'mail.example.com',
        },
      },
    ];

  const prisma = {
    integrationConnection: {
      findMany: async () => providerConnections,
    },
    authActionToken: {
      updateMany: async ({ where, data }) => {
        captured.writes.push({ where, data });
        return { count: where?.id ? 1 : 0 };
      },
      findMany: async () => [row],
    },
  };

  const adapters = new TransactionalEmailProviderAdapterRegistry();
  adapters.register({
    providerCode: 'fake-mail',
    dispatch: async (input) => {
      captured.dispatches.push(input);
      if (providerDispatch) return providerDispatch(input);
      return { providerMessageRef: 'mail-ref-a' };
    },
  });

  const service = new TransactionalEmailDispatchService(
    prisma,
    config,
    { current: () => 'HOMOLOG' },
    {
      resolveForExternalBoundary: async (connectionId, scope) => {
        assert.equal(connectionId, 'email-global-a');
        assert.deepEqual(scope, { scope: 'GLOBAL' });
        return new IntegrationSecretValue('provider-secret');
      },
    },
    adapters,
    {
      record: async (record) => {
        captured.audits.push(record);
      },
    },
  );

  return { service, captured, row };
}

test('G dispatches PASSWORD_RESET through one canonical GLOBAL e-mail connection without persisting secrets', async () => {
  const fx = fixture();

  const result = await fx.service.dispatchDue();

  assert.deepEqual(result, { scanned: 1, delivered: 1 });
  assert.equal(fx.captured.dispatches.length, 1);

  const dispatch = fx.captured.dispatches[0];
  assert.equal(dispatch.dispatchKey, 'action-a');
  assert.equal(dispatch.recipient, 'owner@example.com');
  assert.match(dispatch.subject, /senha/i);
  assert.match(dispatch.textBody, /raw-action-token/);
  assert.match(dispatch.htmlBody, /raw-action-token/);
  assert.equal(dispatch.credential.toJSON(), '[REDACTED]');

  const completed = fx.captured.writes.find(
    ({ data }) => data.deliveryStatus === 'DELIVERED',
  );
  assert.ok(completed);
  assert.equal(completed.data.deliveryCiphertext, null);
  assert.equal(completed.data.deliveryProviderCode, 'fake-mail');
  assert.equal(completed.data.deliveryConnectionId, 'email-global-a');
  assert.equal(completed.data.deliveryProviderMessageRef, 'mail-ref-a');

  const persisted = JSON.stringify(fx.captured.writes);
  const audits = JSON.stringify(fx.captured.audits);
  assert.doesNotMatch(persisted, /raw-action-token|provider-secret/);
  assert.doesNotMatch(audits, /raw-action-token|provider-secret|owner@example.com/);
});

test('G sends EMAIL_CHANGE only to the target e-mail, not the current account e-mail', async () => {
  const fx = fixture({
    rowOverrides: {
      kind: 'EMAIL_CHANGE',
      targetEmail: 'new-owner@example.com',
    },
  });

  const result = await fx.service.dispatchDue();

  assert.equal(result.delivered, 1);
  assert.equal(fx.captured.dispatches[0].recipient, 'new-owner@example.com');
  assert.match(fx.captured.dispatches[0].subject, /alteracao/i);
});

test('G fails closed when more than one GLOBAL e-mail connection is eligible and schedules sanitized retry', async () => {
  const fx = fixture({
    connections: [
      {
        id: 'email-global-a',
        providerCode: 'fake-mail',
        capabilities: ['email.transactional'],
        publicConfiguration: {},
      },
      {
        id: 'email-global-b',
        providerCode: 'fake-mail',
        capabilities: ['email.transactional'],
        publicConfiguration: {},
      },
    ],
  });

  const result = await fx.service.dispatchDue();

  assert.deepEqual(result, { scanned: 1, delivered: 0 });
  assert.equal(fx.captured.dispatches.length, 0);
  const retry = fx.captured.writes.find(
    ({ data }) =>
      data.deliveryErrorCode === 'EMAIL_PROVIDER_CONNECTION_AMBIGUOUS',
  );
  assert.ok(retry);
  assert.equal(retry.data.deliveryStatus, 'PENDING');
  assert.ok(retry.data.deliveryNextAttemptAt instanceof Date);
  assert.notEqual(retry.data.deliveryCiphertext, null);
});

test('G source keeps provider secrets out of PostgreSQL and leaves real provider/DNS homologation external', async () => {
  const [schema, migration, serviceSource, docs] = await Promise.all([
    readFile('prisma/schema.prisma', 'utf8'),
    readFile(
      'prisma/migrations/20260928115000_auth_email_delivery_lifecycle/migration.sql',
      'utf8',
    ),
    readFile(
      'src/modules/transactional-email/transactional-email-dispatch.service.ts',
      'utf8',
    ),
    readFile('docs/G_TRANSACTIONAL_EMAIL_READINESS.md', 'utf8'),
  ]);

  assert.match(schema, /deliveryProviderCode/);
  assert.match(schema, /deliveryConnectionId/);
  assert.match(migration, /deliveryCiphertext" DROP NOT NULL/);
  assert.doesNotMatch(migration, /apiKey|password|secretValue|providerSecret/i);
  assert.match(serviceSource, /resolveForExternalBoundary/);
  assert.match(serviceSource, /email\.transactional/);
  assert.match(docs, /BLOCKED_EXTERNAL/);
  assert.match(docs, /SPF\/DKIM\/DMARC/);
});
