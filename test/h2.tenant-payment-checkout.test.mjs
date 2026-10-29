import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  TenantPaymentCheckoutService,
} = require(
  '../dist/src/modules/financial/tenant-payment-checkout.service.js',
);
const {
  TenantPaymentProviderAdapterRegistry,
} = require(
  '../dist/src/modules/financial/tenant-payment-provider-adapter.js',
);
const {
  IntegrationSecretValue,
} = require(
  '../dist/src/modules/integrations/secrets/integration-secret-vault.port.js',
);

function fixture({ connections } = {}) {
  const captured = {
    secretCalls: [],
    adapterCalls: [],
    updates: [],
    audits: [],
  };

  const connectionRows =
    connections ??
    [
      {
        id: 'tenant-gateway-a',
        scope: 'TENANT',
        gymId: 'gym-a',
        providerCode: 'fake-pay',
        environment: 'HOMOLOG',
        status: 'ACTIVE',
        capabilities: ['billing.student.checkout'],
        publicConfiguration: {
          merchantAccount: 'merchant-a',
        },
        secretReference: 'isv_' + 'A'.repeat(43),
        secretVersion: 1,
        secretRevokedAt: null,
        secretExpiresAt: null,
        updatedAt: new Date(),
      },
    ];

  let charge = {
    id: 'charge-a',
    gymId: 'gym-a',
    studentId: 'student-a',
    subscriptionId: null,
    amount: 26900,
    dueDate: new Date(Date.now() + 86_400_000),
    paidAt: null,
    status: 'PENDING',
    paymentMethod: null,
    gatewayProviderCode: null,
    gatewayConnectionId: null,
    gatewayRequestId: null,
    gatewayChargeId: null,
    gatewayCheckoutExpiresAt: null,
    paymentLink: null,
    pixQrCode: null,
  };

  const prisma = {
    integrationConnection: {
      findMany: async ({ where }) => connectionRows.filter((row) => row.gymId === where.gymId && row.scope === where.scope && row.environment === where.environment && row.status === where.status && (!where.id || row.id === where.id)),
    },
    charge: {
      findFirst: async ({ where }) => {
        if (where.id !== charge.id || where.gymId !== charge.gymId) return null;
        return { ...charge };
      },
      updateMany: async ({ where, data }) => {
        captured.updates.push({ where, data });
        if (
          where.id === charge.id &&
          where.gymId === charge.gymId &&
          charge.gatewayRequestId === null
        ) {
          charge = { ...charge, ...data };
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };

  const registry = new TenantPaymentProviderAdapterRegistry();
  registry.register({
    providerCode: 'fake-pay',
    createCheckout: async (input) => {
      captured.adapterCalls.push(input);
      return {
        providerChargeRef: 'provider-charge-a',
        checkoutUrl: 'https://pay.example.com/checkout/a',
        pixQrCode: null,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      };
    },
  });

  const service = new TenantPaymentCheckoutService(
    prisma,
    { current: () => 'HOMOLOG' },
    {
      resolveForExternalBoundary: async (connectionId, scope) => {
        captured.secretCalls.push({ connectionId, scope });
        return new IntegrationSecretValue('tenant-provider-secret');
      },
    },
    registry,
    {
      record: async (record) => {
        captured.audits.push(record);
      },
    },
  );

  return {
    service,
    captured,
    getCharge: () => charge,
  };
}

test('H2 creates hosted checkout through the canonical TENANT connection and Vault scope', async () => {
  const fx = fixture();

  const result = await fx.service.createSession(
    'charge-a',
    { requestId: '11111111-1111-4111-8111-111111111111' },
    'gym-a',
    'owner-a',
  );

  assert.equal(result.idempotent, false);
  assert.equal(result.providerCode, 'fake-pay');
  assert.equal(result.providerChargeRef, 'provider-charge-a');
  assert.equal(
    result.checkoutUrl,
    'https://pay.example.com/checkout/a',
  );

  assert.deepEqual(fx.captured.secretCalls, [
    {
      connectionId: 'tenant-gateway-a',
      scope: { scope: 'TENANT', gymId: 'gym-a' },
    },
  ]);

  assert.equal(fx.captured.adapterCalls.length, 1);
  assert.equal(
    fx.captured.adapterCalls[0].credential.toJSON(),
    '[REDACTED]',
  );
  assert.equal(fx.captured.adapterCalls[0].amount, 26900);
  assert.equal(fx.captured.adapterCalls[0].currency, 'BRL');

  const stored = JSON.stringify(fx.captured.updates);
  const audits = JSON.stringify(fx.captured.audits);
  assert.doesNotMatch(stored, /tenant-provider-secret/);
  assert.doesNotMatch(audits, /tenant-provider-secret/);
  assert.equal(fx.getCharge().gatewayConnectionId, 'tenant-gateway-a');
});

test('H2 same request id is idempotent and does not call provider twice', async () => {
  const fx = fixture();
  const requestId = '22222222-2222-4222-8222-222222222222';

  const first = await fx.service.createSession(
    'charge-a',
    { requestId },
    'gym-a',
    'owner-a',
  );
  const second = await fx.service.createSession(
    'charge-a',
    { requestId },
    'gym-a',
    'owner-a',
  );

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(fx.captured.adapterCalls.length, 1);
});

test('H2 fails closed on ambiguous tenant gateway authority', async () => {
  const base = {
    scope: 'TENANT',
    gymId: 'gym-a',
    providerCode: 'fake-pay',
    environment: 'HOMOLOG',
    status: 'ACTIVE',
    capabilities: ['billing.student.checkout'],
    secretReference: 'isv_' + 'A'.repeat(43),
    secretVersion: 1,
    secretRevokedAt: null,
    secretExpiresAt: null,
    updatedAt: new Date(),
  };
  const fx = fixture({
    connections: [
      { id: 'gateway-a', ...base },
      { id: 'gateway-b', ...base },
    ],
  });

  await assert.rejects(
    () =>
      fx.service.createSession(
        'charge-a',
        { requestId: '33333333-3333-4333-8333-333333333333' },
        'gym-a',
        'owner-a',
      ),
    /Mais de um gateway ativo/,
  );

  assert.equal(fx.captured.adapterCalls.length, 0);
  assert.equal(fx.captured.secretCalls.length, 0);
});

test('H2 API and persistence expose no raw card authority or free tenant/provider selector', async () => {
  const [dto, controller, schema, migration, docs] = await Promise.all([
    readFile(
      'src/modules/financial/dto/create-charge-payment-session.dto.ts',
      'utf8',
    ),
    readFile('src/modules/financial/financial.controller.ts', 'utf8'),
    readFile('prisma/schema.prisma', 'utf8'),
    readFile(
      'prisma/migrations/20260928123000_tenant_payment_checkout/migration.sql',
      'utf8',
    ),
    readFile('docs/H2_TENANT_PAYMENT_CHECKOUT.md', 'utf8'),
  ]);

  assert.match(dto, /requestId/);
  assert.doesNotMatch(
    dto,
    /gymId|tenantId|providerCode|cardNumber|pan|cvv|cvc|expiry/i,
  );
  assert.match(controller, /resolveGymId\(user, requestedGymId\)/);
  assert.match(controller, /charges\/:id\/payment-session/);

  const chargeBlock = schema.slice(
    schema.indexOf('model Charge {'),
    schema.indexOf('model CommunicationTemplate'),
  );
  assert.doesNotMatch(
    chargeBlock,
    /\b(cardNumber|fullPan|cvv|cvc)\b/i,
  );
  assert.doesNotMatch(
    migration,
    /"(?:cardNumber|fullPan|cvv|cvc)"\s+/i,
  );
  assert.match(docs, /BLOCKED_EXTERNAL/);
  assert.match(docs, /billing\.student\.checkout/);
});

test('H2 explicitly selects one tenant connection when multiple gateways exist', async () => {
  const base = {
    scope: 'TENANT', gymId: 'gym-a', providerCode: 'fake-pay',
    environment: 'HOMOLOG', status: 'ACTIVE',
    capabilities: ['billing.student.checkout'], secretReference: 'isv_' + 'A'.repeat(43),
    secretVersion: 1, secretRevokedAt: null, secretExpiresAt: null, updatedAt: new Date(),
  };
  const fx = fixture({ connections: [
    { ...base, id: 'gateway-a' },
    { ...base, id: 'gateway-b' },
    { ...base, id: 'foreign', gymId: 'gym-b' },
  ] });
  const result = await fx.service.createSession(
    'charge-a',
    { requestId: '77777777-7777-4777-8777-777777777777', providerConnectionId: 'gateway-b' },
    'gym-a', 'owner-a',
  );
  assert.equal(result.idempotent, false);
  assert.equal(fx.captured.secretCalls[0].connectionId, 'gateway-b');
  assert.equal(fx.getCharge().gatewayConnectionId, 'gateway-b');
});

test('H2 cannot select payment connection from another tenant', async () => {
  const fx = fixture({ connections: [{
    id: 'foreign', gymId: 'gym-b', scope: 'TENANT', providerCode: 'fake-pay',
    environment: 'HOMOLOG', status: 'ACTIVE',
    capabilities: ['billing.student.checkout'], secretReference: 'isv_' + 'A'.repeat(43),
    secretVersion: 1, secretRevokedAt: null, secretExpiresAt: null, updatedAt: new Date(),
  }] });
  await assert.rejects(
    () => fx.service.createSession('charge-a', {
      requestId: '88888888-8888-4888-8888-888888888888',
      providerConnectionId: 'foreign',
    }, 'gym-a', 'owner-a'),
    /Gateway tenant nao configurado/,
  );
  assert.equal(fx.captured.secretCalls.length, 0);
  assert.equal(fx.captured.adapterCalls.length, 0);
});

test('H2 lists only active configured tenant gateways without exposing credential data', async () => {
  const base = {
    scope: 'TENANT', gymId: 'gym-a', providerCode: 'fake-pay', environment: 'HOMOLOG',
    status: 'ACTIVE', capabilities: ['billing.student.checkout'],
    secretReference: 'isv_' + 'A'.repeat(43), secretVersion: 1,
    secretRevokedAt: null, secretExpiresAt: null, updatedAt: new Date(),
  };
  const fx = fixture({ connections: [
    { ...base, id: 'gateway-a' },
    { ...base, id: 'gateway-b' },
    { ...base, id: 'foreign', gymId: 'gym-b' },
    { ...base, id: 'revoke', secretRevokedAt: new Date() },
    { ...base, id: 'other-capability', capabilities: ['email.transactional'] },
  ] });
  const choices = await fx.service.listAvailableProviders('gym-a');
  assert.deepEqual(choices, [
    { connectionId: 'gateway-a', providerCode: 'fake-pay' },
    { connectionId: 'gateway-b', providerCode: 'fake-pay' },
  ]);
  assert.doesNotMatch(JSON.stringify(choices), /secret|credential|gymId/);
});
