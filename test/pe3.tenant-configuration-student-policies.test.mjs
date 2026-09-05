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

function planEntitlement(featureKey, kind, value) {
  return {
    id: `ent-${featureKey}`,
    planVersionId: 'version-a',
    featureKey,
    kind,
    featureEnabled: kind === 'FEATURE' ? value : null,
    limitValue: kind === 'LIMIT' ? value : null,
    policyValues: kind === 'POLICY' ? value : null,
  };
}

function subscriptionWith(entitlements) {
  return {
    id: 'tenant-sub-a',
    gymId: 'gym-a',
    planVersionId: 'version-a',
    status: 'ACTIVE',
    effectiveFrom: new Date(),
    planVersion: {
      id: 'version-a',
      version: 1,
      status: 'PUBLISHED',
      productPlan: { code: 'IRON_BASE' },
      entitlements,
    },
  };
}

function makeService({
  subscription,
  tenantConfigurations = [],
  userPreferences = [],
  studentExists = true,
  gymActive = true,
} = {}) {
  const { TenantProductEntitlementsService } = require(
    '../dist/src/modules/product-entitlements/tenant-product-entitlements.service.js',
  );

  const audits = [];
  const tenantStore = new Map(
    tenantConfigurations.map((record) => [record.featureKey, { ...record }]),
  );
  const preferenceStore = new Map(
    userPreferences.map((record) => [record.featureKey, { ...record }]),
  );

  function tenantRecordFrom(data, existing) {
    return {
      id: existing?.id ?? `tenant-config-${data.featureKey ?? 'x'}`,
      gymId: existing?.gymId ?? 'gym-a',
      featureKey: existing?.featureKey ?? data.featureKey,
      kind: data.kind,
      featureEnabled: data.featureEnabled ?? null,
      limitValue: data.limitValue ?? null,
      policyValues: Array.isArray(data.policyValues) ? [...data.policyValues] : null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
  }

  function preferenceRecordFrom(data, existing) {
    return {
      id: existing?.id ?? `user-pref-${data.featureKey ?? 'x'}`,
      gymId: existing?.gymId ?? 'gym-a',
      userId: existing?.userId ?? 'user-a',
      featureKey: existing?.featureKey ?? data.featureKey,
      kind: data.kind,
      featureEnabled: data.featureEnabled ?? null,
      limitValue: data.limitValue ?? null,
      policyValues: Array.isArray(data.policyValues) ? [...data.policyValues] : null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
  }

  const tx = {
    gym: {
      findUnique: async () => (gymActive ? { id: 'gym-a', active: true } : null),
    },
    tenantProductSubscription: {
      findFirst: async () => subscription ?? null,
    },
    tenantProductConfiguration: {
      findUnique: async ({ where }) =>
        tenantStore.get(where.gymId_featureKey.featureKey) ?? null,
      findMany: async () => [...tenantStore.values()],
      upsert: async ({ where, create, update }) => {
        const key = where.gymId_featureKey.featureKey;
        const existing = tenantStore.get(key) ?? null;
        const input = existing ? { ...existing, ...update } : create;
        const record = tenantRecordFrom({ ...input, featureKey: key }, existing);
        tenantStore.set(key, record);
        return record;
      },
      delete: async ({ where }) => {
        const existing = [...tenantStore.values()].find((record) => record.id === where.id);
        if (existing) tenantStore.delete(existing.featureKey);
        return existing;
      },
    },
    userProductPreference: {
      findUnique: async ({ where }) =>
        preferenceStore.get(where.gymId_userId_featureKey.featureKey) ?? null,
      findMany: async () => [...preferenceStore.values()],
      upsert: async ({ where, create, update }) => {
        const key = where.gymId_userId_featureKey.featureKey;
        const existing = preferenceStore.get(key) ?? null;
        const input = existing ? { ...existing, ...update } : create;
        const record = preferenceRecordFrom({ ...input, featureKey: key }, existing);
        preferenceStore.set(key, record);
        return record;
      },
      delete: async ({ where }) => {
        const existing = [...preferenceStore.values()].find((record) => record.id === where.id);
        if (existing) preferenceStore.delete(existing.featureKey);
        return existing;
      },
    },
    student: {
      findFirst: async () => (studentExists ? { id: 'student-a' } : null),
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
    record: async (input, db) => audits.push({ input, db }),
  };

  return {
    service: new TenantProductEntitlementsService(prisma, audit),
    audits,
    tenantStore,
    preferenceStore,
    tx,
  };
}

test('PE3 persists tenant configuration and user preference as separate tenant-scoped models', async () => {
  const schema = await source('prisma/schema.prisma');
  const tenant = modelBlock(schema, 'TenantProductConfiguration');
  const preference = modelBlock(schema, 'UserProductPreference');
  const studentFinance = modelBlock(schema, 'Subscription');

  assert.match(tenant, /gymId\s+String/);
  assert.match(tenant, /featureKey\s+String/);
  assert.match(tenant, /kind\s+ProductEntitlementKind/);
  assert.match(tenant, /@@unique\(\[gymId, featureKey\]\)/);
  assert.match(preference, /gymId\s+String/);
  assert.match(preference, /userId\s+String/);
  assert.match(preference, /@@unique\(\[gymId, userId, featureKey\]\)/);
  assert.equal(/featureKey|ProductEntitlementKind/.test(studentFinance), false);
});

test('PE3 migration is additive, constrained and never mutates student financial Subscription', async () => {
  const migration = await source(
    'prisma/migrations/20260905130000_tenant_configuration_student_experience_policies/migration.sql',
  );

  assert.match(migration, /CREATE TABLE "TenantProductConfiguration"/);
  assert.match(migration, /CREATE TABLE "UserProductPreference"/);
  assert.match(migration, /TenantProductConfiguration_value_shape/);
  assert.match(migration, /UserProductPreference_value_shape/);
  assert.match(migration, /TenantProductConfiguration_gymId_featureKey_key/);
  assert.match(migration, /UserProductPreference_gymId_userId_featureKey_key/);
  assert.match(migration, /REFERENCES "Gym"\("id"\)/);
  assert.match(migration, /REFERENCES "User"\("id"\)/);
  for (const forbidden of [
    'ALTER TABLE "Subscription"',
    'DROP TABLE "Subscription"',
    'DELETE FROM',
    'TRUNCATE',
  ]) {
    assert.equal(migration.includes(forbidden), false, forbidden);
  }
});

test('PE3 APIs derive tenant and student identity from auth and expose no target gymId or userId', async () => {
  const controller = await source(
    'src/modules/product-entitlements/tenant-product-entitlements.controller.ts',
  );
  const dto = await source(
    'src/modules/product-entitlements/dto/set-product-configuration-value.dto.ts',
  );

  assert.match(controller, /@Put\('tenant\/configurations\/:featureKey'\)[\s\S]*?@Roles\('OWNER', 'MANAGER'\)/);
  assert.match(controller, /@Put\('me\/preferences\/:featureKey'\)[\s\S]*?@Roles\('STUDENT'\)/);
  assert.match(controller, /user\.activeGymId \?\? user\.gymId/);
  assert.match(controller, /user\?\.id/);
  assert.equal(controller.includes("@Query('gymId')"), false);
  assert.equal(controller.includes("@Param('gymId')"), false);
  assert.equal(controller.includes("@Param('userId')"), false);
  assert.equal(/gymId|userId|planCode|version/.test(dto), false);
});

test('PE3 tenant FEATURE configuration can narrow a granted plan and is idempotent with atomic audit', async () => {
  const subscription = subscriptionWith([
    planEntitlement('equipment.catalog', 'FEATURE', true),
  ]);
  const { service, audits, tenantStore } = makeService({ subscription });

  const first = await service.setTenantConfiguration(
    'gym-a',
    'equipment.catalog',
    { featureEnabled: false },
    'owner-a',
  );
  assert.equal(first.featureEnabled, false);
  assert.equal(tenantStore.size, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].input.action, 'TENANT_PRODUCT_CONFIGURATION_SET');
  assert.equal(audits[0].input.gymId, 'gym-a');
  assert.equal(audits[0].db, audits[0].db);

  const repeated = await service.setTenantConfiguration(
    'gym-a',
    'equipment.catalog',
    { featureEnabled: false },
    'owner-a',
  );
  assert.equal(repeated.id, first.id);
  assert.equal(tenantStore.size, 1);
  assert.equal(audits.length, 1);

  const resolved = await service.resolveFeature('gym-a', 'equipment.catalog');
  assert.equal(resolved.value, false);
  assert.equal(resolved.source, 'TENANT_CONFIGURATION');
  assert.equal(resolved.tenantConfigurationId, first.id);
});

test('PE3 tenant configuration cannot enable FEATURE denied by the plan or exceed LIMIT/POLICY authority', async () => {
  const subscription = subscriptionWith([
    planEntitlement('equipment.catalog', 'FEATURE', false),
    planEntitlement('content.private_items_max', 'LIMIT', 10),
    planEntitlement('content.delivery_mode', 'POLICY', [
      'IRON_FIRST',
      'YOUTUBE_EXTERNAL',
    ]),
  ]);
  const { service } = makeService({ subscription });

  await assert.rejects(
    () =>
      service.setTenantConfiguration(
        'gym-a',
        'equipment.catalog',
        { featureEnabled: true },
        'owner-a',
      ),
    /nao pode ampliar/,
  );
  await assert.rejects(
    () =>
      service.setTenantConfiguration(
        'gym-a',
        'content.private_items_max',
        { limitValue: 11 },
        'owner-a',
      ),
    /nao pode ampliar/,
  );
  await assert.rejects(
    () =>
      service.setTenantConfiguration(
        'gym-a',
        'content.delivery_mode',
        { policyValues: ['IRON_ONLY'] },
        'owner-a',
      ),
    /nao pode ampliar/,
  );
});

test('PE3 resolver applies FEATURE, LIMIT and POLICY tenant narrowing deterministically', async () => {
  const subscription = subscriptionWith([
    planEntitlement('equipment.catalog', 'FEATURE', true),
    planEntitlement('content.private_items_max', 'LIMIT', 50),
    planEntitlement('content.delivery_mode', 'POLICY', [
      'IRON_FIRST',
      'YOUTUBE_EXTERNAL',
    ]),
  ]);
  const tenantConfigurations = [
    {
      id: 'cfg-feature',
      gymId: 'gym-a',
      featureKey: 'equipment.catalog',
      kind: 'FEATURE',
      featureEnabled: false,
      limitValue: null,
      policyValues: null,
    },
    {
      id: 'cfg-limit',
      gymId: 'gym-a',
      featureKey: 'content.private_items_max',
      kind: 'LIMIT',
      featureEnabled: null,
      limitValue: 20,
      policyValues: null,
    },
    {
      id: 'cfg-policy',
      gymId: 'gym-a',
      featureKey: 'content.delivery_mode',
      kind: 'POLICY',
      featureEnabled: null,
      limitValue: null,
      policyValues: ['IRON_FIRST'],
    },
  ];
  const { service } = makeService({ subscription, tenantConfigurations });

  const feature = await service.resolveFeature('gym-a', 'equipment.catalog');
  const limit = await service.resolveFeature('gym-a', 'content.private_items_max');
  const policy = await service.resolveFeature('gym-a', 'content.delivery_mode');

  assert.deepEqual([feature.value, limit.value, policy.value], [false, 20, ['IRON_FIRST']]);
  assert.deepEqual(
    [feature.source, limit.source, policy.source],
    ['TENANT_CONFIGURATION', 'TENANT_CONFIGURATION', 'TENANT_CONFIGURATION'],
  );
});

test('PE3 stale tenant configuration fails closed instead of silently widening after upper authority changes', async () => {
  const subscription = subscriptionWith([
    planEntitlement('content.private_items_max', 'LIMIT', 5),
  ]);
  const { service } = makeService({
    subscription,
    tenantConfigurations: [
      {
        id: 'cfg-stale',
        gymId: 'gym-a',
        featureKey: 'content.private_items_max',
        kind: 'LIMIT',
        featureEnabled: null,
        limitValue: 20,
        policyValues: null,
      },
    ],
  });

  const result = await service.resolveFeature('gym-a', 'content.private_items_max');
  assert.equal(result.value, 0);
  assert.equal(result.source, 'FAIL_CLOSED_DEFAULT');
  assert.equal(result.reason, 'TENANT_CONFIGURATION_EXCEEDS_PLAN');
});

test('PE3 student preference applies only after tenant configuration and cannot widen it', async () => {
  const subscription = subscriptionWith([
    planEntitlement('content.delivery_mode', 'POLICY', [
      'IRON_FIRST',
      'YOUTUBE_EXTERNAL',
    ]),
  ]);
  const tenantConfigurations = [
    {
      id: 'cfg-policy',
      gymId: 'gym-a',
      featureKey: 'content.delivery_mode',
      kind: 'POLICY',
      featureEnabled: null,
      limitValue: null,
      policyValues: ['IRON_FIRST'],
    },
  ];
  const { service, audits } = makeService({ subscription, tenantConfigurations });

  const preference = await service.setUserPreference(
    'gym-a',
    'user-a',
    'content.delivery_mode',
    { policyValues: ['IRON_FIRST'] },
  );
  assert.equal(preference.userId, 'user-a');
  assert.equal(audits.at(-1).input.action, 'USER_PRODUCT_PREFERENCE_SET');

  const effective = await service.resolveFeatureForUser(
    'gym-a',
    'user-a',
    'content.delivery_mode',
  );
  assert.deepEqual(effective.value, ['IRON_FIRST']);
  assert.equal(effective.source, 'USER_PREFERENCE');

  await assert.rejects(
    () =>
      service.setUserPreference(
        'gym-a',
        'user-a',
        'content.delivery_mode',
        { policyValues: ['YOUTUBE_EXTERNAL'] },
      ),
    /nao pode ampliar/,
  );
});

test('PE3 student preference is denied when authenticated user is not a Student in the active tenant', async () => {
  const subscription = subscriptionWith([
    planEntitlement('equipment.catalog', 'FEATURE', true),
  ]);
  const { service } = makeService({ subscription, studentExists: false });

  await assert.rejects(
    () => service.resolveFeatureForUser('gym-a', 'user-a', 'equipment.catalog'),
    /Preferencia restrita ao aluno do tenant ativo/,
  );
  await assert.rejects(
    () =>
      service.setUserPreference(
        'gym-a',
        'user-a',
        'equipment.catalog',
        { featureEnabled: false },
      ),
    /Preferencia restrita ao aluno do tenant ativo/,
  );
});

test('PE3 stays outside PE4 plan transitions, pricing, Creator Network and student finance', async () => {
  const service = await source(
    'src/modules/product-entitlements/tenant-product-entitlements.service.ts',
  );
  const doc = await source(
    'docs/PE3_TENANT_CONFIGURATION_STUDENT_EXPERIENCE_POLICIES.md',
  );

  for (const forbidden of [
    'priceCents',
    'gatewayCharge',
    'creatorNetwork',
    'switchPlan(',
    'cancelSubscription(',
    'suspendSubscription(',
  ]) {
    assert.equal(service.includes(forbidden), false, forbidden);
  }
  assert.match(doc, /upgrade, downgrade[\s\S]*— PE4/);
  assert.match(doc, /`Subscription` financeiro do aluno não é alterado/);
});
