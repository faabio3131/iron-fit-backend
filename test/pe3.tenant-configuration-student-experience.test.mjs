import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

function makeService({ planValue = true, tenantRow = null, studentRow = null } = {}) {
  const { TenantProductConfigurationService } = require(
    '../dist/src/modules/product-entitlements/tenant-product-configuration.service.js',
  );
  const queries = [];
  const prisma = {
    $queryRaw: async () => {
      queries.push('read');
      if (queries.length === 1) return tenantRow ? [tenantRow] : [];
      return studentRow ? [studentRow] : [];
    },
    student: {
      findFirst: async (args) => {
        queries.push({ studentWhere: args.where });
        return { id: 'student-a', gymId: 'gym-a', userId: 'user-a', status: 'ACTIVE' };
      },
    },
  };
  const tenantEntitlements = {
    resolveFeature: async (_gymId, featureKey) => ({
      featureKey,
      kind: featureKey === 'content.private_items_max' ? 'LIMIT' : featureKey === 'content.delivery_mode' ? 'POLICY' : 'FEATURE',
      value: planValue,
      source: 'PLAN_ENTITLEMENT',
      reason: null,
      subscriptionId: 'tenant-sub-a',
      plan: { code: 'IRON_BASE', version: 1, status: 'PUBLISHED' },
    }),
  };
  return {
    service: new TenantProductConfigurationService(prisma, { record: async () => {} }, tenantEntitlements),
    queries,
  };
}

function modelBlock(schema, name) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `model ${name} missing`);
  return match[0];
}

test('PE3 migration creates physically isolated tenant configuration and student preference tables with shape checks', async () => {
  const migration = await source(
    'prisma/migrations/20260905140500_tenant_configuration_student_experience/migration.sql',
  );

  assert.match(migration, /CREATE TABLE "TenantProductConfiguration"/);
  assert.match(migration, /CREATE TABLE "StudentProductPreference"/);
  assert.match(migration, /TenantProductConfiguration_value_shape/);
  assert.match(migration, /StudentProductPreference_value_shape/);
  assert.match(migration, /UNIQUE INDEX "TenantProductConfiguration_gymId_featureKey_key"/);
  assert.match(migration, /UNIQUE INDEX "StudentProductPreference_studentId_featureKey_key"/);
  assert.match(migration, /REFERENCES "Gym"\("id"\)/);
  assert.match(migration, /REFERENCES "Student"\("id"\)/);
  for (const forbidden of ['ALTER TABLE "Subscription"', 'DROP TABLE', 'DELETE FROM "Student"']) {
    assert.equal(migration.includes(forbidden), false, forbidden);
  }
});

test('PE3 Prisma schema mirrors both migration tables and tenant/student relations', async () => {
  const schema = await source('prisma/schema.prisma');
  const tenant = modelBlock(schema, 'TenantProductConfiguration');
  const preference = modelBlock(schema, 'StudentProductPreference');
  const gym = modelBlock(schema, 'Gym');
  const student = modelBlock(schema, 'Student');

  assert.match(tenant, /gymId\s+String/);
  assert.match(tenant, /featureKey\s+String/);
  assert.match(tenant, /kind\s+ProductEntitlementKind/);
  assert.match(tenant, /@@unique\(\[gymId, featureKey\]\)/);
  assert.match(tenant, /gym\s+Gym\s+@relation/);
  assert.match(preference, /studentId\s+String/);
  assert.match(preference, /@@unique\(\[studentId, featureKey\]\)/);
  assert.match(preference, /student\s+Student\s+@relation/);
  assert.match(gym, /productConfigurations\s+TenantProductConfiguration\[\]/);
  assert.match(student, /productPreferences\s+StudentProductPreference\[\]/);
});

test('PE3 controller derives tenant and student exclusively from authenticated identity', async () => {
  const controller = await source(
    'src/modules/product-entitlements/tenant-product-configuration.controller.ts',
  );

  assert.match(controller, /user\.activeGymId \?\? user\.gymId/);
  assert.match(controller, /user\?\.id/);
  assert.equal(controller.includes("@Query('gymId')"), false);
  assert.equal(controller.includes("@Param('gymId')"), false);
  assert.equal(controller.includes("@Body() gymId"), false);
  assert.equal(controller.includes('studentId:'), false);
  assert.match(controller, /@Put\('tenant\/configurations\/:featureKey'\)[\s\S]*?@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER'\)/);
  assert.match(controller, /@Put\('student\/preferences\/:featureKey'\)[\s\S]*?@Roles\('STUDENT'\)/);
});

test('PE3 tenant FEATURE configuration may narrow true to false and becomes effective source', async () => {
  const row = {
    id: 'cfg-a',
    featureKey: 'equipment.catalog',
    kind: 'FEATURE',
    featureEnabled: false,
    limitValue: null,
    policyValues: null,
  };
  const { service } = makeService({ planValue: true, tenantRow: row });
  const resolved = await service.resolveTenantFeature('gym-a', 'equipment.catalog');

  assert.equal(resolved.value, false);
  assert.equal(resolved.source, 'TENANT_CONFIGURATION');
  assert.equal(resolved.configurationId, 'cfg-a');
});

test('PE3 corrupt or expanding tenant configuration fails closed instead of falling back to a wider plan', async () => {
  const row = {
    id: 'cfg-bad',
    featureKey: 'equipment.catalog',
    kind: 'FEATURE',
    featureEnabled: true,
    limitValue: null,
    policyValues: null,
  };
  const { service } = makeService({ planValue: false, tenantRow: row });
  const resolved = await service.resolveTenantFeature('gym-a', 'equipment.catalog');

  assert.equal(resolved.value, false);
  assert.equal(resolved.source, 'FAIL_CLOSED_DEFAULT');
  assert.equal(resolved.reason, 'INVALID_TENANT_CONFIGURATION');
});

test('PE3 LIMIT and POLICY use canonical monotonic narrowing helpers', async () => {
  const serviceSource = await source(
    'src/modules/product-entitlements/tenant-product-configuration.service.ts',
  );
  assert.match(serviceSource, /canNarrowFeature/);
  assert.match(serviceSource, /canNarrowLimit/);
  assert.match(serviceSource, /canNarrowPolicy/);
  assert.match(serviceSource, /Configuracao tenant nao pode ampliar entitlement do plano/);
  assert.match(serviceSource, /Preferencia do aluno nao pode ampliar configuracao do tenant/);
  assert.match(serviceSource, /allowedPolicyValues/);
});

test('PE3 student resolution binds ACTIVE Student to authenticated user plus tenant and never accepts client studentId', async () => {
  const { service, queries } = makeService({ planValue: true });
  const resolved = await service.resolveStudentFeature('gym-a', 'user-a', 'equipment.catalog');

  const lookup = queries.find((entry) => typeof entry === 'object');
  assert.deepEqual(lookup.studentWhere, {
    gymId: 'gym-a',
    userId: 'user-a',
    status: 'ACTIVE',
  });
  assert.equal(resolved.studentId, 'student-a');
});

test('PE3 writes are serializable, upsert-idempotent by logical key and audited atomically', async () => {
  const { TenantProductConfigurationService } = require(
    '../dist/src/modules/product-entitlements/tenant-product-configuration.service.js',
  );
  const audits = [];
  let readCount = 0;
  const tx = {
    $queryRaw: async () => {
      readCount += 1;
      if (readCount === 1) return [];
      return [
        {
          id: 'cfg-write',
          featureKey: 'equipment.catalog',
          kind: 'FEATURE',
          featureEnabled: false,
          limitValue: null,
          policyValues: null,
        },
      ];
    },
    $executeRaw: async () => 1,
  };
  const prisma = {
    $transaction: async (operation, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return operation(tx);
    },
  };
  const tenantEntitlements = {
    resolveFeature: async () => ({
      featureKey: 'equipment.catalog',
      kind: 'FEATURE',
      value: true,
      source: 'PLAN_ENTITLEMENT',
      reason: null,
      subscriptionId: 'sub-a',
      plan: { code: 'IRON_BASE', version: 1, status: 'PUBLISHED' },
    }),
  };
  const service = new TenantProductConfigurationService(
    prisma,
    { record: async (input, db) => audits.push({ input, db }) },
    tenantEntitlements,
  );

  const result = await service.setTenantConfiguration(
    'gym-a',
    'equipment.catalog',
    { kind: 'FEATURE', featureEnabled: false },
    'owner-a',
  );
  assert.equal(result.id, 'cfg-write');
  assert.equal(audits[0].input.gymId, 'gym-a');
  assert.equal(audits[0].input.userId, 'owner-a');
  assert.equal(audits[0].input.action, 'TENANT_PRODUCT_CONFIGURATION_SET');
  assert.equal(audits[0].db, tx);

  const serviceSource = await source(
    'src/modules/product-entitlements/tenant-product-configuration.service.ts',
  );
  assert.match(serviceSource, /ON CONFLICT \("gymId", "featureKey"\) DO UPDATE/);
  assert.match(serviceSource, /ON CONFLICT \("studentId", "featureKey"\) DO UPDATE/);
});

test('PE3 module wires the new layer and scope remains outside PE4, pricing, Creator Network and student finance', async () => {
  const moduleSource = await source(
    'src/modules/product-entitlements/product-entitlements.module.ts',
  );
  const serviceSource = await source(
    'src/modules/product-entitlements/tenant-product-configuration.service.ts',
  );
  const doc = await source('docs/PE3_TENANT_CONFIGURATION_STUDENT_EXPERIENCE.md');

  assert.match(moduleSource, /TenantProductConfigurationController/);
  assert.match(moduleSource, /TenantProductConfigurationService/);
  for (const forbidden of [
    'switchPlan(',
    'cancelSubscription(',
    'suspendSubscription(',
    'priceCents',
    'gatewayCharge',
    'creatorNetwork',
  ]) {
    assert.equal(serviceSource.includes(forbidden), false, forbidden);
  }
  assert.match(doc, /upgrade\/downgrade[\s\S]*PE4/);
  assert.match(doc, /não implementa[\s\S]*pricing/);
  assert.match(doc, /`Subscription` financeiro do aluno/);
});
