import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('commercial capability catalog is persistent and physically governs every entitlement layer', async () => {
  const catalogSchema = await readFile('prisma/product-capabilities.prisma', 'utf8');
  const mainSchema = await readFile('prisma/schema.prisma', 'utf8');
  const migration = await readFile(
    'prisma/migrations/20260927162000_configurable_product_capabilities/migration.sql',
    'utf8',
  );

  assert.match(catalogSchema, /model ProductCapabilityDefinition/);
  assert.match(catalogSchema, /status\s+ProductCapabilityStatus/);
  assert.match(mainSchema, /ProductPlanEntitlement[\s\S]*capability\s+ProductCapabilityDefinition/);
  assert.match(mainSchema, /TenantProductConfiguration[\s\S]*capability\s+ProductCapabilityDefinition/);
  assert.match(mainSchema, /UserProductPreference[\s\S]*capability\s+ProductCapabilityDefinition/);

  assert.match(migration, /ProductPlanEntitlement_featureKey_fkey/);
  assert.match(migration, /TenantProductConfiguration_featureKey_fkey/);
  assert.match(migration, /UserProductPreference_featureKey_fkey/);
  assert.match(migration, /content\.external_youtube/);
  assert.match(migration, /aggregator\.wellhub/);
  assert.match(migration, /aggregator\.totalpass/);
  assert.equal(migration.includes('IRON_BASE'), false);
  assert.equal(migration.includes('amountMinor'), false);
});

test('runtime plan and tenant services no longer consult PRODUCT_FEATURE_CATALOG_V1', async () => {
  const planService = await readFile(
    'src/modules/product-entitlements/product-entitlements.service.ts',
    'utf8',
  );
  const tenantService = await readFile(
    'src/modules/product-entitlements/tenant-product-entitlements.service.ts',
    'utf8',
  );
  const contract = await readFile(
    'src/modules/product-entitlements/contracts/product-entitlement-contract.ts',
    'utf8',
  );

  assert.equal(planService.includes('PRODUCT_FEATURE_CATALOG_V1'), false);
  assert.equal(tenantService.includes('PRODUCT_FEATURE_CATALOG_V1'), false);
  assert.match(contract, /Historical PE0 bootstrap fixture only/);
});

test('SUPER_ADMIN can create a new capability as data and a draft plan can use it without code edit', async () => {
  const { ProductCapabilityCatalogService } = require(
    '../dist/src/modules/product-entitlements/product-capability-catalog.service.js',
  );
  const { ProductEntitlementsService } = require(
    '../dist/src/modules/product-entitlements/product-entitlements.service.js',
  );

  const capabilityStore = new Map();
  const entitlements = new Map();
  const audits = [];

  const tx = {
    productCapabilityDefinition: {
      findUnique: async ({ where }) => capabilityStore.get(where.key) ?? null,
      findMany: async () => [...capabilityStore.values()],
      create: async ({ data }) => {
        const record = {
          ...data,
          allowedPolicyValues: Array.isArray(data.allowedPolicyValues)
            ? [...data.allowedPolicyValues]
            : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        capabilityStore.set(record.key, record);
        return record;
      },
      update: async ({ where, data }) => {
        const current = capabilityStore.get(where.key);
        const record = { ...current, ...data, updatedAt: new Date() };
        capabilityStore.set(where.key, record);
        return record;
      },
    },
    productPlan: {
      findUnique: async () => ({ id: 'plan-a', code: 'CUSTOM_PLAN' }),
    },
    productPlanVersion: {
      findFirst: async () => ({
        id: 'version-a',
        version: 1,
        status: 'DRAFT',
        productPlan: { code: 'CUSTOM_PLAN' },
      }),
    },
    productPlanEntitlement: {
      findUnique: async ({ where }) =>
        entitlements.get(where.planVersionId_featureKey.featureKey) ?? null,
      upsert: async ({ create, update, where }) => {
        const key = where.planVersionId_featureKey.featureKey;
        const current = entitlements.get(key);
        const record = {
          id: current?.id ?? 'ent-' + key,
          planVersionId: 'version-a',
          featureKey: key,
          ...(current ? update : create),
          createdAt: current?.createdAt ?? new Date(),
          updatedAt: new Date(),
        };
        entitlements.set(key, record);
        return record;
      },
    },
  };

  const prisma = {
    ...tx,
    $transaction: async (operation, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return operation(tx);
    },
  };
  const audit = {
    record: async (entry, db) => audits.push({ entry, db }),
  };

  const capabilities = new ProductCapabilityCatalogService(prisma, audit);
  await capabilities.create(
    {
      key: 'integration.meta_marketing',
      kind: 'FEATURE',
      domain: 'INTEGRATION',
      description: 'Meta marketing integration for entitled tenants',
    },
    'super-admin-a',
  );

  assert.equal(capabilityStore.has('integration.meta_marketing'), true);

  const plans = new ProductEntitlementsService(prisma, audit, capabilities);
  const entitlement = await plans.setEntitlement(
    'plan-a',
    1,
    {
      featureKey: 'integration.meta_marketing',
      featureEnabled: true,
    },
    'super-admin-a',
  );

  assert.equal(entitlement.featureKey, 'integration.meta_marketing');
  assert.equal(entitlement.kind, 'FEATURE');
  assert.equal(entitlement.featureEnabled, true);
  assert.ok(audits.some(({ entry }) => entry.action === 'PRODUCT_CAPABILITY_CREATED'));
  assert.ok(audits.some(({ entry }) => entry.action === 'PRODUCT_PLAN_ENTITLEMENT_CREATED'));
});

test('retiring capability blocks new plans but preserves historical resolution semantics', async () => {
  const { ProductCapabilityCatalogService } = require(
    '../dist/src/modules/product-entitlements/product-capability-catalog.service.js',
  );

  const record = {
    key: 'content.partner_premium',
    kind: 'FEATURE',
    domain: 'CONTENT',
    description: 'Premium partner content',
    allowedPolicyValues: null,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const store = new Map([[record.key, record]]);
  const tx = {
    productCapabilityDefinition: {
      findUnique: async ({ where }) => store.get(where.key) ?? null,
      findMany: async () => [...store.values()],
      update: async ({ where, data }) => {
        const next = { ...store.get(where.key), ...data, updatedAt: new Date() };
        store.set(where.key, next);
        return next;
      },
    },
  };
  const prisma = {
    ...tx,
    $transaction: async (operation) => operation(tx),
  };
  const service = new ProductCapabilityCatalogService(
    prisma,
    { record: async () => ({}) },
  );

  await service.retire(record.key, 'super-admin-a');
  await assert.rejects(
    service.requireActive(record.key),
    /aposentada nao pode entrar em novo plano/,
  );

  const historical = await service.requireForResolution(record.key);
  assert.equal(historical.key, record.key);
  assert.equal(historical.kind, 'FEATURE');
  assert.equal(historical.failClosedDefault, false);
});

test('capability governance is global SUPER_ADMIN-only and exposes no tenant selector', async () => {
  const controller = await readFile(
    'src/modules/product-entitlements/product-capabilities.controller.ts',
    'utf8',
  );
  const dto = await readFile(
    'src/modules/product-entitlements/dto/create-product-capability.dto.ts',
    'utf8',
  );

  assert.match(controller, /@Roles\('SUPER_ADMIN'\)/);
  assert.equal(controller.includes('activeGymId'), false);
  assert.equal(controller.includes("@Query('gymId')"), false);
  assert.equal(dto.includes('gymId'), false);
  assert.equal(dto.includes('planCode'), false);
  assert.equal(dto.includes('price'), false);
});
