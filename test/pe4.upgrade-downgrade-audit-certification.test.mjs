import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function source(path) {
  return readFile(path, 'utf8');
}

function baseSubscription(overrides = {}) {
  return {
    id: 'sub-current',
    gymId: 'gym-a',
    planVersionId: 'pv-old',
    status: 'ACTIVE',
    effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
    effectiveUntil: null,
    planVersion: {
      version: 1,
      status: 'PUBLISHED',
      productPlan: { code: 'IRON_BASE' },
    },
    ...overrides,
  };
}

function targetVersion(overrides = {}) {
  return {
    id: 'pv-new',
    version: 2,
    status: 'PUBLISHED',
    productPlan: { code: 'IRON_PRO' },
    ...overrides,
  };
}

function makeLifecycle({ current = baseSubscription(), target = targetVersion() } = {}) {
  const { TenantProductSubscriptionLifecycleService } = require(
    '../dist/src/modules/product-entitlements/tenant-product-subscription-lifecycle.service.js',
  );
  const audits = [];
  const creates = [];
  const updates = [];
  const tx = {
    gym: {
      findUnique: async ({ where }) =>
        where.id === 'gym-a' ? { id: 'gym-a', active: true } : null,
    },
    productPlanVersion: {
      findFirst: async () => target,
    },
    tenantProductSubscription: {
      findFirst: async () => current,
      update: async ({ where, data }) => {
        updates.push({ where, data });
        return {
          ...current,
          status: data.status,
          effectiveUntil: data.effectiveUntil,
        };
      },
      create: async ({ data }) => {
        creates.push(data);
        return {
          id: 'sub-next',
          ...data,
          effectiveUntil: null,
          planVersion: target,
        };
      },
    },
  };
  const prisma = {
    $transaction: async (operation, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return operation(tx);
    },
  };
  const audit = {
    record: async (entry, db) => audits.push({ entry, db }),
  };
  return {
    service: new TenantProductSubscriptionLifecycleService(prisma, audit),
    tx,
    audits,
    creates,
    updates,
  };
}

test('PE4 has no migration because PE2 already supplies lifecycle window and one-ACTIVE physical constraint', async () => {
  const pe2Migration = await source(
    'prisma/migrations/20260905121500_tenant_product_subscription_feature_resolution/migration.sql',
  );
  const doc = await source('docs/PE4_UPGRADE_DOWNGRADE_AUDIT_CERTIFICATION.md');

  assert.match(pe2Migration, /"effectiveFrom" TIMESTAMP/);
  assert.match(pe2Migration, /"effectiveUntil" TIMESTAMP/);
  assert.match(pe2Migration, /TenantProductSubscription_one_active_per_gym/);
  assert.match(pe2Migration, /WHERE "status" = 'ACTIVE'/);
  assert.match(doc, /PE4 não requer nova migration/);
});

test('PE4 transition endpoint is SUPER_ADMIN-only and does not expose tenant transition to OWNER/MANAGER', async () => {
  const controller = await source(
    'src/modules/product-entitlements/tenant-product-subscription-lifecycle.controller.ts',
  );
  assert.match(controller, /@Post\('transition'\)/);
  assert.match(controller, /@Roles\('SUPER_ADMIN'\)/);
  assert.equal(controller.includes("@Roles('OWNER'"), false);
  assert.equal(controller.includes("@Roles('MANAGER'"), false);
});

test('PE4 performs atomic historical close then creates one new ACTIVE subscription and audit', async () => {
  const { service, audits, creates, updates, tx } = makeLifecycle();
  const result = await service.transition(
    {
      gymId: 'gym-a',
      expectedCurrentSubscriptionId: 'sub-current',
      planCode: 'IRON_PRO',
      version: 2,
      transitionKind: 'UPGRADE',
      reason: 'Mudanca aprovada',
    },
    'super-admin-a',
  );

  assert.equal(result.changed, true);
  assert.equal(result.idempotent, false);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, 'sub-current');
  assert.equal(updates[0].data.status, 'CANCELED');
  assert.ok(updates[0].data.effectiveUntil instanceof Date);
  assert.equal(creates.length, 1);
  assert.equal(creates[0].gymId, 'gym-a');
  assert.equal(creates[0].planVersionId, 'pv-new');
  assert.equal(creates[0].status, 'ACTIVE');
  assert.equal(creates[0].effectiveFrom.getTime(), updates[0].data.effectiveUntil.getTime());
  assert.equal(audits.length, 1);
  assert.equal(audits[0].entry.action, 'TENANT_PRODUCT_SUBSCRIPTION_TRANSITIONED');
  assert.equal(audits[0].entry.gymId, 'gym-a');
  assert.equal(audits[0].entry.userId, 'super-admin-a');
  assert.equal(audits[0].entry.previous.planCode, 'IRON_BASE');
  assert.equal(audits[0].entry.next.planCode, 'IRON_PRO');
  assert.equal(audits[0].entry.next.previousSubscriptionId, 'sub-current');
  assert.equal(audits[0].entry.next.transitionKind, 'UPGRADE');
  assert.equal(audits[0].db, tx);
});

test('PE4 replay to already-active target is idempotent and creates no history or audit', async () => {
  const current = baseSubscription({
    id: 'sub-new',
    planVersionId: 'pv-new',
    planVersion: targetVersion(),
  });
  const { service, audits, creates, updates } = makeLifecycle({ current });
  const result = await service.transition({
    gymId: 'gym-a',
    expectedCurrentSubscriptionId: 'sub-current-stale',
    planCode: 'IRON_PRO',
    version: 2,
    transitionKind: 'UPGRADE',
    reason: 'Replay',
  });

  assert.equal(result.changed, false);
  assert.equal(result.idempotent, true);
  assert.equal(result.subscription.id, 'sub-new');
  assert.equal(creates.length, 0);
  assert.equal(updates.length, 0);
  assert.equal(audits.length, 0);
});

test('PE4 optimistic expectedCurrentSubscriptionId rejects stale concurrent intent for a different target', async () => {
  const { service, audits, creates, updates } = makeLifecycle();
  await assert.rejects(
    () =>
      service.transition({
        gymId: 'gym-a',
        expectedCurrentSubscriptionId: 'outdated-subscription',
        planCode: 'IRON_PRO',
        version: 2,
        transitionKind: 'DOWNGRADE',
        reason: 'Snapshot antigo',
      }),
    /Assinatura SaaS corrente mudou/,
  );
  assert.equal(creates.length, 0);
  assert.equal(updates.length, 0);
  assert.equal(audits.length, 0);
});

test('PE4 rejects DRAFT or RETIRED targets for new transition', async () => {
  for (const status of ['DRAFT', 'RETIRED']) {
    const { service, creates, updates } = makeLifecycle({
      target: targetVersion({ status }),
    });
    await assert.rejects(
      () =>
        service.transition({
          gymId: 'gym-a',
          expectedCurrentSubscriptionId: 'sub-current',
          planCode: 'IRON_PRO',
          version: 2,
          transitionKind: 'PLAN_CHANGE',
          reason: 'Target invalido',
        }),
      /Somente versao PUBLISHED/,
    );
    assert.equal(creates.length, 0);
    assert.equal(updates.length, 0);
  }
});

test('PE4 transition code never mutates student financial Subscription, Charge, pricing, gateway or PE3 stored layers', async () => {
  const lifecycle = await source(
    'src/modules/product-entitlements/tenant-product-subscription-lifecycle.service.ts',
  );
  for (const forbidden of [
    '.subscription.',
    '.charge.',
    'priceCents',
    'gateway',
    'tenantProductConfiguration.update',
    'tenantProductConfiguration.delete',
    'userProductPreference.update',
    'userProductPreference.delete',
  ]) {
    assert.equal(lifecycle.includes(forbidden), false, forbidden);
  }
  assert.match(lifecycle, /tenantProductSubscription\.update/);
  assert.match(lifecycle, /tenantProductSubscription\.create/);
});

test('PE4 certifies PE3 downgrade behavior remains fail-closed rather than deleting stale lower-layer configuration', async () => {
  const pe3 = await source(
    'src/modules/product-entitlements/tenant-product-entitlements.service.ts',
  );
  const pe4 = await source(
    'src/modules/product-entitlements/tenant-product-subscription-lifecycle.service.ts',
  );
  assert.match(pe3, /TENANT_CONFIGURATION_EXCEEDS_PLAN/);
  assert.match(pe3, /USER_PREFERENCE_EXCEEDS_TENANT_CONFIGURATION/);
  assert.match(pe3, /FAIL_CLOSED_DEFAULT/);
  assert.equal(pe4.includes('tenantProductConfiguration.delete'), false);
  assert.equal(pe4.includes('userProductPreference.delete'), false);
});

test('PE4 full phase certification keeps product domain plan-code-neutral and student finance separated', async () => {
  const contract = await source(
    'src/modules/product-entitlements/contracts/product-entitlement-contract.ts',
  );
  const lifecycle = await source(
    'src/modules/product-entitlements/tenant-product-subscription-lifecycle.service.ts',
  );
  const doc = await source('docs/PE4_UPGRADE_DOWNGRADE_AUDIT_CERTIFICATION.md');

  assert.equal(/if\s*\(\s*plan\s*===/.test(lifecycle), false);
  assert.match(contract, /PLAN_ENTITLEMENT/);
  assert.match(contract, /TENANT_CONFIGURATION/);
  assert.match(contract, /USER_PREFERENCE/);
  assert.match(doc, /Subscription` financeiro do aluno permanece fisicamente e semanticamente separado/);
  assert.match(doc, /Fase E — FITNESS CREATOR NETWORK \/ IRON-CN0 pode ser liberada/);
});
