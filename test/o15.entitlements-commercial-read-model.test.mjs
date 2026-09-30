import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

function fixture() {
  const { TenantProductEntitlementsService } = require(
    '../dist/src/modules/product-entitlements/tenant-product-entitlements.service.js',
  );

  const definitions = [
    {
      key: 'content.private_items_max',
      kind: 'LIMIT',
      domain: 'CONTENT',
      description: 'Limite de conteúdo privado da academia.',
      failClosedDefault: 0,
    },
    {
      key: 'content.delivery_mode',
      kind: 'POLICY',
      domain: 'CONTENT',
      description: 'Modos de entrega permitidos.',
      failClosedDefault: null,
      allowedPolicyValues: ['IRON_FIRST', 'YOUTUBE_EXTERNAL'],
    },
  ];

  const subscription = {
    id: 'tenant-sub-a',
    gymId: 'gym-a',
    status: 'ACTIVE',
    effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
    planVersion: {
      version: 3,
      status: 'PUBLISHED',
      productPlan: { code: 'IRON_PRO', name: 'IRON Pro' },
      entitlements: [
        {
          featureKey: 'content.private_items_max',
          kind: 'LIMIT',
          featureEnabled: null,
          limitValue: 50,
          policyValues: null,
        },
        {
          featureKey: 'content.delivery_mode',
          kind: 'POLICY',
          featureEnabled: null,
          limitValue: null,
          policyValues: ['IRON_FIRST', 'YOUTUBE_EXTERNAL'],
        },
      ],
    },
  };

  const prisma = {
    gym: {
      findUnique: async () => ({ id: 'gym-a', active: true }),
    },
    tenantProductSubscription: {
      findFirst: async () => subscription,
    },
    tenantProductConfiguration: {
      findMany: async () => [
        {
          id: 'cfg-limit',
          gymId: 'gym-a',
          featureKey: 'content.private_items_max',
          kind: 'LIMIT',
          featureEnabled: null,
          limitValue: 20,
          policyValues: null,
        },
      ],
    },
  };

  const capabilities = {
    listForResolution: async () => definitions,
  };

  return new TenantProductEntitlementsService(
    prisma,
    { record: async () => undefined },
    capabilities,
  );
}

test('O15 tenant feature read model exposes product metadata and preserves plan value before tenant narrowing', async () => {
  const service = fixture();
  const result = await service.resolveAll('gym-a');

  const limit = result.find((item) => item.featureKey === 'content.private_items_max');
  assert.equal(limit.value, 20);
  assert.equal(limit.planValue, 50);
  assert.equal(limit.source, 'TENANT_CONFIGURATION');
  assert.deepEqual(limit.definition, {
    domain: 'CONTENT',
    description: 'Limite de conteúdo privado da academia.',
    allowedPolicyValues: null,
  });

  const policy = result.find((item) => item.featureKey === 'content.delivery_mode');
  assert.deepEqual(policy.value, ['IRON_FIRST', 'YOUTUBE_EXTERNAL']);
  assert.deepEqual(policy.planValue, ['IRON_FIRST', 'YOUTUBE_EXTERNAL']);
  assert.deepEqual(policy.definition.allowedPolicyValues, [
    'IRON_FIRST',
    'YOUTUBE_EXTERNAL',
  ]);
});

test('O15 metadata is additive and does not weaken tenant configuration authority', async () => {
  const [controller, service] = await Promise.all([
    readFile(
      'src/modules/product-entitlements/tenant-product-entitlements.controller.ts',
      'utf8',
    ),
    readFile(
      'src/modules/product-entitlements/tenant-product-entitlements.service.ts',
      'utf8',
    ),
  ]);

  assert.match(
    controller,
    /@Put\('tenant\/configurations\/:featureKey'\)[\s\S]*?@UseGuards\(StepUpGuard\)[\s\S]*?@Roles\('SUPER_ADMIN', 'OWNER'\)/,
  );
  assert.match(service, /this\.isNarrowingAllowed\(definition, parent\.value, built\.value\)/);
  assert.match(service, /Configuracao do tenant nao pode ampliar/);
  assert.match(service, /planValue: planResolution\.value/);
  assert.match(service, /allowedPolicyValues:/);
});
