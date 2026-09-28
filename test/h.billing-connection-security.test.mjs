import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

const {
  SaasBillingProviderConnectionService,
} = require(
  '../dist/src/modules/saas-billing/saas-billing-provider-connection.service.js',
);
const {
  SaasBillingProviderRegistry,
} = require(
  '../dist/src/modules/saas-billing/saas-billing-provider.registry.js',
);
const {
  IntegrationSecretValue,
} = require(
  '../dist/src/modules/integrations/secrets/integration-secret-vault.port.js',
);

function sandboxAdapter() {
  return {
    code: 'INTERNAL_SANDBOX',
    assertAvailable: () => undefined,
    createCheckout: async () => {
      throw new Error('not used');
    },
    requestRefund: async () => {
      throw new Error('not used');
    },
    verifyWebhook: () => undefined,
  };
}

function realAdapter(captured) {
  return {
    code: 'real-pay',
    assertAvailable: (context) => {
      captured.assertContext = context;
    },
    createCheckout: async (_input, context) => {
      captured.checkoutContext = context;
      return {
        providerSessionRef: 'real-checkout-a',
        checkoutUrl: 'https://pay.example.com/checkout/a',
        expiresAt: new Date(Date.now() + 60_000),
      };
    },
    requestRefund: async (_input, context) => {
      captured.refundContext = context;
      return {
        providerRefundRef: 'real-refund-a',
        status: 'SUCCEEDED',
      };
    },
    verifyWebhook: (_payload, _signature, context) => {
      captured.webhookContext = context;
    },
  };
}

function fixture({ connections, configuredProvider } = {}) {
  const captured = {};
  const registry = new SaasBillingProviderRegistry(sandboxAdapter());
  registry.register(realAdapter(captured));

  const rows =
    connections ??
    [
      {
        id: 'billing-global-a',
        scope: 'GLOBAL',
        gymId: null,
        providerCode: 'real-pay',
        environment: 'HOMOLOG',
        status: 'ACTIVE',
        capabilities: ['billing.saas.fm'],
        publicConfiguration: {
          merchantAccount: 'fm-platform',
        },
        secretReference: 'isv_' + 'A'.repeat(43),
        secretVersion: 2,
        secretRevokedAt: null,
        secretExpiresAt: null,
        updatedAt: new Date(),
      },
    ];

  const service = new SaasBillingProviderConnectionService(
    {
      integrationConnection: {
        findMany: async () => rows,
      },
    },
    {
      get: (name) =>
        name === 'SAAS_BILLING_PROVIDER' ? configuredProvider : undefined,
    },
    { current: () => 'HOMOLOG' },
    {
      resolveForExternalBoundary: async (connectionId, scope) => {
        assert.equal(connectionId, 'billing-global-a');
        assert.deepEqual(scope, { scope: 'GLOBAL' });
        return new IntegrationSecretValue('vault-provider-secret');
      },
    },
    registry,
  );

  return { service, captured };
}

test('H1 resolves exactly one GLOBAL FM billing connection and exposes only redacted Vault credential', async () => {
  const fx = fixture();

  const resolved = await fx.service.resolve();

  assert.equal(resolved.code, 'real-pay');
  assert.equal(resolved.connectionId, 'billing-global-a');
  assert.equal(resolved.sandboxOnly, false);
  assert.equal(resolved.context.connectionId, 'billing-global-a');
  assert.deepEqual(resolved.context.publicConfiguration, {
    merchantAccount: 'fm-platform',
  });
  assert.equal(resolved.context.credential.toJSON(), '[REDACTED]');
  assert.equal(fx.captured.assertContext.credential.toJSON(), '[REDACTED]');
});

test('H1 fails closed when FM billing connection authority is ambiguous', async () => {
  const base = {
    providerCode: 'real-pay',
    capabilities: ['billing.saas.fm'],
  };
  const fx = fixture({
    connections: [
      { id: 'billing-a', ...base },
      { id: 'billing-b', ...base },
    ],
  });

  await assert.rejects(
    () => fx.service.resolve(),
    /GLOBAL ambiguo/,
  );
});

test('H1 optional provider pin cannot redirect webhook/checkout to a different provider', async () => {
  const fx = fixture({ configuredProvider: 'real-pay' });

  await assert.rejects(
    () => fx.service.resolve('other-provider'),
    /nao autorizado/,
  );

  const resolved = await fx.service.resolve('real-pay');
  assert.equal(resolved.code, 'real-pay');
});

test('H3/H4 source keeps card secrets out of SaaS billing DTO/schema and binds checkout, refund and webhook to provider context', async () => {
  const [dto, schema, serviceSource, docs] = await Promise.all([
    readFile('src/modules/saas-billing/dto/saas-billing.dto.ts', 'utf8'),
    readFile('prisma/schema.prisma', 'utf8'),
    readFile('src/modules/saas-billing/saas-billing.service.ts', 'utf8'),
    readFile('docs/H_BILLING_CONNECTION_SECURITY.md', 'utf8'),
  ]);

  assert.doesNotMatch(
    dto,
    /\b(cvv|cvc|cardNumber|pan|fullPan)\b/i,
  );

  const billingSchema = schema.slice(
    schema.indexOf('model SaasPlanPrice'),
    schema.indexOf('model ProductFeature'),
  );
  assert.doesNotMatch(
    billingSchema,
    /\b(cvv|cvc|cardNumber|pan|fullPan)\b/i,
  );

  assert.match(serviceSource, /provider\.adapter\.createCheckout/);
  assert.match(serviceSource, /provider\.adapter\.requestRefund/);
  assert.match(serviceSource, /verifyWebhook\(dto, signature, provider\.context\)/);
  assert.match(docs, /BLOCKED_EXTERNAL/);
  assert.match(docs, /Hosted Checkout|hosted checkout/i);
});
