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

function serviceWith(tx, auditRecords = []) {
  const { ProductEntitlementsService } = require(
    '../dist/src/modules/product-entitlements/product-entitlements.service.js',
  );
  return new ProductEntitlementsService(
    {
      $transaction: async (operation, options) => {
        assert.equal(options.isolationLevel, 'Serializable');
        return operation(tx);
      },
      productPlan: tx.productPlan,
    },
    {
      record: async (input, db) => {
        auditRecords.push({ input, db });
      },
    },
  );
}

test('PE1 creates global versioned ProductPlan domain physically separated from student Subscription', async () => {
  const schema = await source('prisma/schema.prisma');
  const plan = modelBlock(schema, 'ProductPlan');
  const version = modelBlock(schema, 'ProductPlanVersion');
  const entitlement = modelBlock(schema, 'ProductPlanEntitlement');
  const studentSubscription = modelBlock(schema, 'Subscription');

  assert.match(schema, /enum ProductPlanVersionStatus[\s\S]*DRAFT[\s\S]*PUBLISHED[\s\S]*RETIRED/);
  assert.match(schema, /enum ProductEntitlementKind[\s\S]*FEATURE[\s\S]*LIMIT[\s\S]*POLICY/);
  assert.match(plan, /code\s+String\s+@unique/);
  assert.match(version, /@@unique\(\[productPlanId, version\]\)/);
  assert.match(entitlement, /@@unique\(\[planVersionId, featureKey\]\)/);
  assert.equal(/gymId/.test(plan), false);
  assert.equal(/gymId/.test(version), false);
  assert.equal(/gymId/.test(entitlement), false);
  assert.match(studentSubscription, /gymId\s+String/);
  assert.match(studentSubscription, /studentId\s+String/);
  assert.match(studentSubscription, /amount\s+Int/);
  assert.equal(/productPlanId/.test(studentSubscription), false);
});

test('PE1 migration is additive and enforces positive version plus entitlement value shape', async () => {
  const migration = await source(
    'prisma/migrations/20260905114500_versioned_product_plans_entitlements/migration.sql',
  );

  assert.match(migration, /CREATE TABLE "ProductPlan"/);
  assert.match(migration, /CREATE TABLE "ProductPlanVersion"/);
  assert.match(migration, /CREATE TABLE "ProductPlanEntitlement"/);
  assert.match(migration, /ProductPlanVersion_version_positive/);
  assert.match(migration, /ProductPlanEntitlement_value_shape/);
  assert.match(migration, /"limitValue" >= 0/);
  for (const forbidden of [
    'DROP TABLE "Subscription"',
    'ALTER TABLE "Subscription"',
    'DROP TABLE "Gym"',
    'ALTER TABLE "Gym"',
    'DELETE FROM',
  ]) {
    assert.equal(migration.includes(forbidden), false, forbidden);
  }
});

test('PE1 governance API is SUPER_ADMIN-only and never accepts tenant authority', async () => {
  const controller = await source(
    'src/modules/product-entitlements/product-entitlements.controller.ts',
  );
  const dtos = [
    await source('src/modules/product-entitlements/dto/create-product-plan.dto.ts'),
    await source('src/modules/product-entitlements/dto/create-product-plan-version.dto.ts'),
    await source('src/modules/product-entitlements/dto/set-product-plan-entitlement.dto.ts'),
  ].join('\n');

  assert.equal((controller.match(/@Roles\('SUPER_ADMIN'\)/g) ?? []).length, 6);
  assert.equal(controller.includes('resolveTenantOperationGymId'), false);
  assert.equal(controller.includes("@Query('gymId')"), false);
  assert.equal(/gymId|activeGymId/.test(dtos), false);
});

test('PE1 ProductPlan creation is global, serializable, idempotent and atomically audited', async () => {
  const audits = [];
  const plan = {
    id: 'plan-a',
    code: 'IRON_BASE',
    name: 'IRON Base',
    description: null,
  };
  let createCalls = 0;
  const tx = {
    productPlan: {
      findUnique: async () => null,
      create: async ({ data }) => {
        createCalls += 1;
        return { ...plan, ...data };
      },
    },
  };
  const service = serviceWith(tx, audits);

  const result = await service.createPlan(
    { code: 'IRON_BASE', name: 'IRON Base' },
    'super-admin-a',
  );

  assert.equal(result.code, 'IRON_BASE');
  assert.equal(createCalls, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].input.gymId, null);
  assert.equal(audits[0].input.action, 'PRODUCT_PLAN_CREATED');
  assert.equal(audits[0].db, tx);

  tx.productPlan.findUnique = async () => plan;
  const idempotent = await service.createPlan(
    { code: 'IRON_BASE', name: 'IRON Base' },
    'super-admin-a',
  );
  assert.equal(idempotent.id, plan.id);
  assert.equal(createCalls, 1);
});

test('PE1 derives entitlement kind from canonical PE0 catalog and rejects unknown or invalid values', async () => {
  let upsertData;
  const tx = {
    productPlanVersion: {
      findFirst: async () => ({
        id: 'version-a',
        version: 1,
        status: 'DRAFT',
        productPlan: { code: 'IRON_BASE' },
      }),
    },
    productPlanEntitlement: {
      findUnique: async () => null,
      upsert: async (args) => {
        upsertData = args;
        return {
          id: 'entitlement-a',
          featureKey: args.create.featureKey,
          kind: args.create.kind,
          featureEnabled: args.create.featureEnabled,
          limitValue: args.create.limitValue,
          policyValues: null,
        };
      },
    },
  };
  const service = serviceWith(tx);

  const result = await service.setEntitlement(
    'plan-a',
    1,
    { featureKey: 'equipment.catalog', featureEnabled: true },
    'super-admin-a',
  );
  assert.equal(result.kind, 'FEATURE');
  assert.equal(upsertData.create.kind, 'FEATURE');
  assert.equal(upsertData.create.featureEnabled, true);
  assert.equal(upsertData.create.limitValue, null);

  await assert.rejects(
    () =>
      service.setEntitlement(
        'plan-a',
        1,
        { featureKey: 'unknown.feature', featureEnabled: true },
        'super-admin-a',
      ),
    /Capability nao canonica/,
  );

  await assert.rejects(
    () =>
      service.setEntitlement(
        'plan-a',
        1,
        { featureKey: 'content.delivery_mode', policyValues: ['INVENTED_MODE'] },
        'super-admin-a',
      ),
    /valor nao autorizado/,
  );
});

test('PE1 forbids entitlement mutation after publication before any upsert', async () => {
  let upsertCalls = 0;
  const tx = {
    productPlanVersion: {
      findFirst: async () => ({
        id: 'version-a',
        version: 1,
        status: 'PUBLISHED',
        productPlan: { code: 'IRON_BASE' },
      }),
    },
    productPlanEntitlement: {
      findUnique: async () => null,
      upsert: async () => {
        upsertCalls += 1;
      },
    },
  };
  const service = serviceWith(tx);

  await assert.rejects(
    () =>
      service.setEntitlement(
        'plan-a',
        1,
        { featureKey: 'equipment.catalog', featureEnabled: true },
        'super-admin-a',
      ),
    /imutavel/,
  );
  assert.equal(upsertCalls, 0);
});

test('PE1 publish validates persisted canonical entitlements, freezes the version and audits globally', async () => {
  const audits = [];
  let updateData;
  const stored = {
    id: 'entitlement-a',
    planVersionId: 'version-a',
    featureKey: 'content.external_youtube',
    kind: 'FEATURE',
    featureEnabled: true,
    limitValue: null,
    policyValues: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const tx = {
    productPlanVersion: {
      findFirst: async () => ({
        id: 'version-a',
        productPlanId: 'plan-a',
        version: 1,
        status: 'DRAFT',
        publishedAt: null,
        retiredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        productPlan: { code: 'IRON_BASE' },
        entitlements: [stored],
      }),
      update: async ({ data }) => {
        updateData = data;
        return {
          id: 'version-a',
          version: 1,
          status: data.status,
          publishedAt: data.publishedAt,
          productPlan: { code: 'IRON_BASE' },
          entitlements: [stored],
        };
      },
    },
  };
  const service = serviceWith(tx, audits);
  const result = await service.publishVersion('plan-a', 1, 'super-admin-a');

  assert.equal(updateData.status, 'PUBLISHED');
  assert.ok(updateData.publishedAt instanceof Date);
  assert.equal(result.status, 'PUBLISHED');
  assert.equal(audits[0].input.gymId, null);
  assert.equal(audits[0].input.action, 'PRODUCT_PLAN_VERSION_PUBLISHED');
});

test('PE1 stays outside tenant subscription, runtime resolution, pricing and Creator Network', async () => {
  const service = await source(
    'src/modules/product-entitlements/product-entitlements.service.ts',
  );
  const controller = await source(
    'src/modules/product-entitlements/product-entitlements.controller.ts',
  );
  const doc = await source('docs/PE1_VERSIONED_PRODUCT_PLANS_ENTITLEMENTS.md');

  for (const forbidden of [
    'tenantSubscription',
    'activeGymId',
    'resolveEffectiveEntitlement',
    'priceCents',
    'creatorNetwork',
    "if (plan ===",
  ]) {
    assert.equal(service.includes(forbidden), false, forbidden);
    assert.equal(controller.includes(forbidden), false, forbidden);
  }
  assert.match(doc, /ligacao de academia a uma versao de produto pertence ao PE2/i);
  assert.match(doc, /nao implementa:[\s\S]*assinatura SaaS de academia/i);
});
