import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

function modelBlock(schema, name) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `model ${name} missing`);
  return match[0];
}

function makeService({ gym, subscription, transaction } = {}) {
  const { TenantProductEntitlementsService } = require(
    '../dist/src/modules/product-entitlements/tenant-product-entitlements.service.js',
  );
  const audits = [];
  const prisma = {
    gym: {
      findUnique: async () => gym ?? { id: 'gym-a', active: true },
    },
    tenantProductSubscription: {
      findFirst: async () => subscription ?? null,
    },
    $transaction: async (operation, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return operation(transaction);
    },
  };
  const audit = {
    record: async (input, db) => audits.push({ input, db }),
  };
  return { service: new TenantProductEntitlementsService(prisma, audit), audits };
}

function subscriptionWith({ status = 'PUBLISHED', entitlements = [] } = {}) {
  return {
    id: 'tenant-sub-a',
    gymId: 'gym-a',
    status: 'ACTIVE',
    planVersionId: 'version-a',
    effectiveFrom: new Date(),
    planVersion: {
      id: 'version-a',
      version: 1,
      status,
      productPlan: { code: 'IRON_BASE' },
      entitlements,
    },
  };
}

test('PE2 creates tenant SaaS subscription physically distinct from student financial Subscription', async () => {
  const schema = await source('prisma/schema.prisma');
  const tenant = modelBlock(schema, 'TenantProductSubscription');
  const student = modelBlock(schema, 'Subscription');

  assert.match(schema, /enum TenantProductSubscriptionStatus[\s\S]*ACTIVE[\s\S]*SUSPENDED[\s\S]*CANCELED/);
  assert.match(tenant, /gymId\s+String/);
  assert.match(tenant, /planVersionId\s+String/);
  assert.equal(/studentId|amount|gatewaySubId/.test(tenant), false);
  assert.match(student, /studentId\s+String/);
  assert.match(student, /amount\s+Int/);
  assert.equal(/planVersionId|TenantProductSubscriptionStatus/.test(student), false);
});

test('PE2 migration is additive and physically allows at most one ACTIVE SaaS subscription per gym', async () => {
  const migration = await source(
    'prisma/migrations/20260905121500_tenant_product_subscription_feature_resolution/migration.sql',
  );

  assert.match(migration, /CREATE TABLE "TenantProductSubscription"/);
  assert.match(migration, /TenantProductSubscription_one_active_per_gym/);
  assert.match(migration, /WHERE "status" = 'ACTIVE'/);
  assert.match(migration, /TenantProductSubscription_effective_window/);
  for (const forbidden of [
    'ALTER TABLE "Subscription"',
    'DROP TABLE "Subscription"',
    'DELETE FROM',
    'DROP TABLE "Gym"',
  ]) {
    assert.equal(migration.includes(forbidden), false, forbidden);
  }
});

test('PE2 tenant reads derive gym exclusively from authenticated identity and global assignment is SUPER_ADMIN-only', async () => {
  const controller = await source(
    'src/modules/product-entitlements/tenant-product-entitlements.controller.ts',
  );
  const dto = await source(
    'src/modules/product-entitlements/dto/assign-tenant-product-subscription.dto.ts',
  );

  assert.match(controller, /user\.activeGymId \?\? user\.gymId/);
  assert.equal(controller.includes("@Query('gymId')"), false);
  assert.equal(controller.includes("@Param('gymId')"), false);
  assert.match(controller, /@Post\('tenant-subscriptions'\)[\s\S]*?@Roles\('SUPER_ADMIN'\)/);
  assert.match(dto, /gymId: string/);
  assert.equal(dto.includes('studentId'), false);
});

test('PE2 resolver fails closed without an active tenant subscription for FEATURE, LIMIT and POLICY', async () => {
  const { service } = makeService();

  const feature = await service.resolveFeature('gym-a', 'equipment.catalog');
  const limit = await service.resolveFeature('gym-a', 'content.private_items_max');
  const policy = await service.resolveFeature('gym-a', 'content.delivery_mode');

  assert.deepEqual(
    [feature.value, limit.value, policy.value],
    [false, 0, null],
  );
  assert.equal(feature.source, 'FAIL_CLOSED_DEFAULT');
  assert.equal(feature.reason, 'NO_ACTIVE_TENANT_SUBSCRIPTION');
});

test('PE2 resolves an explicit valid entitlement and preserves active contracts pinned to RETIRED versions', async () => {
  const published = subscriptionWith({
    entitlements: [
      {
        id: 'ent-a',
        planVersionId: 'version-a',
        featureKey: 'equipment.catalog',
        kind: 'FEATURE',
        featureEnabled: true,
        limitValue: null,
        policyValues: null,
      },
    ],
  });
  const { service } = makeService({ subscription: published });
  const granted = await service.resolveFeature('gym-a', 'equipment.catalog');
  assert.equal(granted.value, true);
  assert.equal(granted.source, 'PLAN_ENTITLEMENT');
  assert.equal(granted.plan.code, 'IRON_BASE');

  const retired = subscriptionWith({
    status: 'RETIRED',
    entitlements: published.planVersion.entitlements,
  });
  const { service: retiredService } = makeService({ subscription: retired });
  const historical = await retiredService.resolveFeature('gym-a', 'equipment.catalog');
  assert.equal(historical.value, true);
  assert.equal(historical.plan.status, 'RETIRED');
});

test('PE2 rejects invalid persisted shape or non-effective DRAFT version by returning canonical defaults', async () => {
  const invalid = subscriptionWith({
    entitlements: [
      {
        id: 'ent-bad',
        planVersionId: 'version-a',
        featureKey: 'equipment.catalog',
        kind: 'FEATURE',
        featureEnabled: null,
        limitValue: 99,
        policyValues: null,
      },
    ],
  });
  const { service } = makeService({ subscription: invalid });
  const bad = await service.resolveFeature('gym-a', 'equipment.catalog');
  assert.equal(bad.value, false);
  assert.equal(bad.reason, 'INVALID_ENTITLEMENT_DATA');

  const draft = subscriptionWith({ status: 'DRAFT' });
  const { service: draftService } = makeService({ subscription: draft });
  const unavailable = await draftService.resolveFeature('gym-a', 'equipment.catalog');
  assert.equal(unavailable.value, false);
  assert.equal(unavailable.reason, 'PLAN_VERSION_NOT_EFFECTIVE');
});

test('PE2 initial assignment is serializable, tenant-bound, idempotent and refuses upgrade/downgrade anticipation', async () => {
  const audits = [];
  let createCalls = 0;
  const version = {
    id: 'version-a',
    version: 1,
    status: 'PUBLISHED',
    productPlan: { code: 'IRON_BASE' },
  };
  const created = {
    id: 'tenant-sub-a',
    gymId: 'gym-a',
    planVersionId: 'version-a',
    status: 'ACTIVE',
    effectiveFrom: new Date(),
    planVersion: version,
  };
  const tx = {
    gym: { findUnique: async () => ({ id: 'gym-a', active: true }) },
    productPlanVersion: { findFirst: async () => version },
    tenantProductSubscription: {
      findFirst: async () => null,
      create: async () => {
        createCalls += 1;
        return created;
      },
    },
  };
  const { TenantProductEntitlementsService } = require(
    '../dist/src/modules/product-entitlements/tenant-product-entitlements.service.js',
  );
  const service = new TenantProductEntitlementsService(
    {
      $transaction: async (operation, options) => {
        assert.equal(options.isolationLevel, 'Serializable');
        return operation(tx);
      },
    },
    { record: async (input, db) => audits.push({ input, db }) },
  );

  const assigned = await service.assignInitialSubscription(
    { gymId: 'gym-a', planCode: 'IRON_BASE', version: 1 },
    'super-admin-a',
  );
  assert.equal(assigned.id, 'tenant-sub-a');
  assert.equal(createCalls, 1);
  assert.equal(audits[0].input.gymId, 'gym-a');
  assert.equal(audits[0].input.action, 'TENANT_PRODUCT_SUBSCRIPTION_ASSIGNED');
  assert.equal(audits[0].db, tx);

  tx.tenantProductSubscription.findFirst = async () => created;
  const idempotent = await service.assignInitialSubscription(
    { gymId: 'gym-a', planCode: 'IRON_BASE', version: 1 },
    'super-admin-a',
  );
  assert.equal(idempotent.id, created.id);
  assert.equal(createCalls, 1);

  tx.tenantProductSubscription.findFirst = async () => ({
    ...created,
    planVersionId: 'version-other',
  });
  await assert.rejects(
    () =>
      service.assignInitialSubscription(
        { gymId: 'gym-a', planCode: 'IRON_BASE', version: 1 },
        'super-admin-a',
      ),
    /upgrade\/downgrade pertence ao IRON-PE4/,
  );
});

test('PE2 remains outside PE3 configuration, PE4 transitions, pricing, Creator Network and student finance', async () => {
  const service = await source(
    'src/modules/product-entitlements/tenant-product-entitlements.service.ts',
  );
  const doc = await source('docs/PE2_TENANT_SUBSCRIPTION_FEATURE_RESOLUTION.md');

  for (const forbidden of [
    'TenantConfiguration',
    'UserPreference',
    'priceCents',
    'gatewayCharge',
    'creatorNetwork',
    'switchPlan(',
    'cancelSubscription(',
    'suspendSubscription(',
  ]) {
    assert.equal(service.includes(forbidden), false, forbidden);
  }
  assert.match(doc, /configuração de academia ou preferência do aluno\/usuário — PE3/);
  assert.match(doc, /upgrade, downgrade[\s\S]*— PE4/);
  assert.match(doc, /`Subscription` já existente continua exclusivamente financeiro/);
});
