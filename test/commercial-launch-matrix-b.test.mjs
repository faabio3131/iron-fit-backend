import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

function requiredItems() {
  const { MASTER_REQUIRED_LAUNCH_ITEMS } = require(
    '../dist/src/modules/commercial-launch/commercial-launch.constants.js',
  );
  return MASTER_REQUIRED_LAUNCH_ITEMS;
}

function matrixItems(decisions = {}) {
  return requiredItems().map((required) => ({
    id: 'item-' + required.itemKey,
    matrixId: 'matrix-a',
    itemKey: required.itemKey,
    kind: required.kind,
    decision:
      decisions[required.itemKey] ??
      required.requiredDecision ??
      'OUT',
    featureKey: required.expectedFeatureKey ?? null,
    rationale:
      (decisions[required.itemKey] ?? required.requiredDecision) === 'LAUNCH'
        ? null
        : 'Not part of the approved launch scope',
    blockerOwner: null,
    evidenceRequirement: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

function basePolicy(overrides = {}) {
  return {
    id: 'policy-a',
    matrixId: 'matrix-a',
    trialEnabled: false,
    trialPlanVersionId: null,
    trialDays: null,
    invoiceDueDays: 3,
    dunningGraceDays: 5,
    upgradePolicy: 'IMMEDIATE_PRORATED',
    downgradePolicy: 'NEXT_PERIOD_NO_IMMEDIATE_REFUND',
    cancellationPolicy: 'IMMEDIATE_OR_PERIOD_END',
    refundPolicy: 'SUPER_ADMIN_MANUAL',
    fiscalMode: 'OUT',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function basePrice() {
  return {
    id: 'price-a',
    priceCode: 'price-a',
    planVersionId: 'plan-version-a',
    currency: 'BRL',
    amountMinor: 10000,
    interval: 'MONTHLY',
    active: true,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveUntil: null,
    planVersion: {
      id: 'plan-version-a',
      version: 1,
      status: 'PUBLISHED',
      productPlan: {
        id: 'plan-a',
        code: 'PLAN_A',
      },
    },
  };
}

function baseMatrix(overrides = {}) {
  return {
    id: 'matrix-a',
    version: 1,
    name: 'IRON V1 Launch',
    status: 'DRAFT',
    snapshotHash: null,
    createdByUserId: 'admin-a',
    approvedByUserId: null,
    approvedAt: null,
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: matrixItems(),
    offerings: [
      {
        id: 'offering-a',
        matrixId: 'matrix-a',
        planVersionId: 'plan-version-a',
        priceId: 'price-a',
        createdAt: new Date(),
      },
    ],
    policy: basePolicy(),
    ...overrides,
  };
}

function fakeService(overrides = {}) {
  const { CommercialLaunchService } = require(
    '../dist/src/modules/commercial-launch/commercial-launch.service.js',
  );
  const matrix = overrides.matrix ?? baseMatrix();
  const price = overrides.price ?? basePrice();
  const tx = {
    commercialLaunchMatrix: {
      findUnique: async () => matrix,
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({
        ...matrix,
        status: 'APPROVED',
        snapshotHash: 'a'.repeat(64),
        approvedByUserId: 'admin-a',
        approvedAt: new Date(),
      }),
      ...(overrides.commercialLaunchMatrix ?? {}),
    },
    saasPlanPrice: {
      findMany: async () => [price],
      findUnique: async () => price,
      ...(overrides.saasPlanPrice ?? {}),
    },
    productPlanEntitlement: {
      findMany: async ({ where }) => {
        if (where.featureKey === 'content.external_youtube') {
          return [{
            kind: 'FEATURE',
            featureEnabled: true,
            limitValue: null,
            policyValues: null,
          }];
        }
        return [];
      },
      ...(overrides.productPlanEntitlement ?? {}),
    },
    productPlanVersion: {
      findUnique: async () => null,
      ...(overrides.productPlanVersion ?? {}),
    },
    commercialLaunchItem: overrides.commercialLaunchItem ?? {},
    commercialLaunchOffering: overrides.commercialLaunchOffering ?? {},
    commercialLaunchPolicy: overrides.commercialLaunchPolicy ?? {},
  };
  const prisma = {
    ...tx,
    $transaction: async (fn) => fn(tx),
  };
  return {
    service: new CommercialLaunchService(
      prisma,
      overrides.audit ?? { record: async () => ({}) },
      overrides.auth ?? { assertStepUp: async () => ({}) },
      overrides.capabilities ?? {
        requireActive: async () => ({ key: 'content.external_youtube' }),
      },
    ),
    tx,
  };
}

test('B Launch Matrix requires mandatory launch surfaces but leaves optional decisions human-controlled', () => {
  const items = requiredItems();
  const byKey = new Map(items.map((item) => [item.itemKey, item]));

  for (const key of [
    'surface.core',
    'surface.web',
    'service.email',
    'service.billing',
    'content.external_youtube',
  ]) {
    assert.equal(byKey.get(key)?.requiredDecision, 'LAUNCH');
  }

  for (const key of [
    'mobile.android',
    'mobile.ios',
    'ai.workout_generation',
    'ai.content_recommendation',
    'creator.iron_managed',
    'creator.tenant_private',
    'provider.wellhub',
    'provider.totalpass',
    'channel.meta',
    'channel.google',
  ]) {
    assert.equal(byKey.get(key)?.requiredDecision, undefined);
  }

  assert.equal(
    byKey.get('provider.wellhub')?.expectedFeatureKey,
    'aggregator.wellhub',
  );
  assert.equal(
    byKey.get('creator.tenant_private')?.expectedFeatureKey,
    'content.tenant_private',
  );
});

test('B Launch Matrix approval fails when a required human decision is missing', async () => {
  const matrix = baseMatrix({
    items: matrixItems({ 'mobile.android': 'UNDECIDED' }),
  });
  const { service } = fakeService({ matrix });

  await assert.rejects(
    service.approve('matrix-a', 'admin-a', {
      currentPassword: 'Strong-Pass-2026!',
      confirmation: 'APPROVE_LAUNCH_MATRIX',
    }),
    /Decisao humana pendente: mobile\.android/,
  );
});

test('B Launch Matrix approval rejects OUT capability still granted by a launch offering', async () => {
  const matrix = baseMatrix();
  const { service } = fakeService({
    matrix,
    productPlanEntitlement: {
      findMany: async ({ where }) => {
        if (
          where.featureKey === 'content.external_youtube' ||
          where.featureKey === 'aggregator.wellhub'
        ) {
          return [{
            kind: 'FEATURE',
            featureEnabled: true,
            limitValue: null,
            policyValues: null,
          }];
        }
        return [];
      },
    },
  });

  await assert.rejects(
    service.approve('matrix-a', 'admin-a', {
      currentPassword: 'Strong-Pass-2026!',
      confirmation: 'APPROVE_LAUNCH_MATRIX',
    }),
    /provider\.wellhub nao e LAUNCH, mas capability continua concedida/,
  );
});

test('B Launch Matrix approval requires step-up before any commercial promotion', async () => {
  let matrixReads = 0;
  const { service } = fakeService({
    auth: {
      assertStepUp: async () => {
        throw new Error('STEP_UP_REQUIRED');
      },
    },
    commercialLaunchMatrix: {
      findUnique: async () => {
        matrixReads += 1;
        return baseMatrix();
      },
    },
  });

  await assert.rejects(
    service.approve('matrix-a', 'admin-a', {
      currentPassword: 'bad',
      confirmation: 'APPROVE_LAUNCH_MATRIX',
    }),
    /STEP_UP_REQUIRED/,
  );
  assert.equal(matrixReads, 0);
});

test('B Launch Matrix approved matrices are immutable', async () => {
  const approved = baseMatrix({ status: 'APPROVED' });
  const { service } = fakeService({
    matrix: approved,
    commercialLaunchItem: {
      findUnique: async () => null,
      upsert: async () => {
        throw new Error('MUST_NOT_WRITE');
      },
    },
  });

  await assert.rejects(
    service.upsertItem('matrix-a', {
      itemKey: 'channel.meta',
      kind: 'CHANNEL',
      decision: 'OUT',
      rationale: 'Explicitly outside launch scope',
    }, 'admin-a'),
    /imutavel/,
  );
});

test('B Launch Matrix policy refuses ambiguous trial shape', async () => {
  const { service } = fakeService();
  await assert.rejects(
    service.setPolicy(
      'matrix-a',
      {
        trialEnabled: true,
        invoiceDueDays: 3,
        dunningGraceDays: 5,
        upgradePolicy: 'IMMEDIATE_PRORATED',
        downgradePolicy: 'NEXT_PERIOD_NO_IMMEDIATE_REFUND',
        cancellationPolicy: 'IMMEDIATE_OR_PERIOD_END',
        refundPolicy: 'SUPER_ADMIN_MANUAL',
        fiscalMode: 'OUT',
      },
      'admin-a',
    ),
    /Trial habilitado exige/,
  );
});

test('B launch governance is SUPER_ADMIN-only and contains no tenant/package-name authority', async () => {
  const controller = await readFile(
    'src/modules/commercial-launch/commercial-launch.controller.ts',
    'utf8',
  );
  const constants = await readFile(
    'src/modules/commercial-launch/commercial-launch.constants.ts',
    'utf8',
  );
  const dto = await readFile(
    'src/modules/commercial-launch/dto/commercial-launch.dto.ts',
    'utf8',
  );

  assert.match(controller, /@Roles\('SUPER_ADMIN'\)/);
  assert.match(controller, /APPROVE_LAUNCH_MATRIX|approve/);
  assert.doesNotMatch(dto, /gymId|tenantId/);
  assert.doesNotMatch(constants, /START|BASIC|PRO|PREMIUM|ENTERPRISE/);
});

test('B launch migration enforces one approved matrix and immutable approval shape', async () => {
  const migration = await readFile(
    'prisma/migrations/20260927214500_commercial_launch_matrix_authority/migration.sql',
    'utf8',
  );
  assert.match(migration, /CommercialLaunchMatrix_one_approved/);
  assert.match(migration, /WHERE "status" = 'APPROVED'/);
  assert.match(migration, /CommercialLaunchMatrix_approval_shape/);
  assert.match(migration, /snapshotHash/);
  assert.match(migration, /CommercialLaunchPolicy_trial_shape/);
});
