import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

const ROLE_NAMES = [
  'SUPER_ADMIN',
  'OWNER',
  'MANAGER',
  'RECEPTION',
  'TRAINER',
  'STUDENT',
];

const FEATURES = [
  'content.external_youtube',
  'equipment.catalog',
  'equipment.inventory',
  'ai.workout_generation',
  'ai.content_recommendation',
];

async function ensurePlan(code, name) {
  const plan = await prisma.productPlan.upsert({
    where: { code },
    update: { name },
    create: { code, name },
  });
  const version = await prisma.productPlanVersion.upsert({
    where: {
      productPlanId_version: {
        productPlanId: plan.id,
        version: 1,
      },
    },
    update: {
      status: 'PUBLISHED',
      publishedAt: new Date(),
      retiredAt: null,
    },
    create: {
      productPlanId: plan.id,
      version: 1,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  for (const featureKey of FEATURES) {
    await prisma.productPlanEntitlement.upsert({
      where: {
        planVersionId_featureKey: {
          planVersionId: version.id,
          featureKey,
        },
      },
      update: {
        kind: 'FEATURE',
        featureEnabled: true,
        limitValue: null,
        policyValues: null,
      },
      create: {
        planVersionId: version.id,
        featureKey,
        kind: 'FEATURE',
        featureEnabled: true,
      },
    });
  }

  return { plan, version };
}

async function main() {
  for (const name of ROLE_NAMES) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, description: `B6 ${name}` },
    });
  }

  const trial = await ensurePlan('IRON_B6_TRIAL', 'IRON B6 Trial');
  await prisma.productPlanEntitlement.upsert({
    where: {
      planVersionId_featureKey: {
        planVersionId: trial.version.id,
        featureKey: 'commercial.trial_students_max',
      },
    },
    update: {
      kind: 'LIMIT',
      featureEnabled: null,
      limitValue: 15,
      policyValues: null,
    },
    create: {
      planVersionId: trial.version.id,
      featureKey: 'commercial.trial_students_max',
      kind: 'LIMIT',
      limitValue: 15,
    },
  });
  const basic = await ensurePlan('IRON_B6_BASIC', 'IRON B6 Basic');
  const pro = await ensurePlan('IRON_B6_PRO', 'IRON B6 Pro');

  await prisma.equipmentCatalogItem.upsert({
    where: { slug: 'iron-b6-bench-canonical' },
    update: { active: true },
    create: {
      slug: 'iron-b6-bench-canonical',
      name: 'IRON B6 Bench Canonical',
      category: 'PLATE_LOADED',
      primaryMuscle: 'CHEST',
      active: true,
    },
  });

  const basicPrice = await prisma.saasPlanPrice.upsert({
    where: { priceCode: 'IRON_B6_BASIC_MONTHLY' },
    update: {
      planVersionId: basic.version.id,
      currency: 'BRL',
      amountMinor: 10000,
      interval: 'MONTHLY',
      active: true,
      effectiveUntil: null,
    },
    create: {
      priceCode: 'IRON_B6_BASIC_MONTHLY',
      planVersionId: basic.version.id,
      currency: 'BRL',
      amountMinor: 10000,
      interval: 'MONTHLY',
      active: true,
    },
  });

  const proPrice = await prisma.saasPlanPrice.upsert({
    where: { priceCode: 'IRON_B6_PRO_MONTHLY' },
    update: {
      planVersionId: pro.version.id,
      currency: 'BRL',
      amountMinor: 20000,
      interval: 'MONTHLY',
      active: true,
      effectiveUntil: null,
    },
    create: {
      priceCode: 'IRON_B6_PRO_MONTHLY',
      planVersionId: pro.version.id,
      currency: 'BRL',
      amountMinor: 20000,
      interval: 'MONTHLY',
      active: true,
    },
  });

  const adminPassword = process.env.B6_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('B6_ADMIN_PASSWORD obrigatoria no E2E');
  const adminHash = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { email: 'b6-admin@example.com' },
    update: {
      passwordHash: adminHash,
      active: true,
      emailVerifiedAt: new Date(),
      mfaEnabled: false,
      mfaSecret: null,
    },
    create: {
      email: 'b6-admin@example.com',
      name: 'B6 Super Admin',
      passwordHash: adminHash,
      active: true,
      emailVerifiedAt: new Date(),
    },
  });

  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { name: 'SUPER_ADMIN' },
  });
  const existing = await prisma.userRole.findFirst({
    where: {
      userId: admin.id,
      roleId: superAdminRole.id,
      gymId: null,
    },
  });
  if (!existing) {
    await prisma.userRole.create({
      data: {
        userId: admin.id,
        roleId: superAdminRole.id,
        gymId: null,
        assignedBy: admin.id,
      },
    });
  }

  const launchVersion = 900006;
  const matrix = await prisma.commercialLaunchMatrix.upsert({
    where: { version: launchVersion },
    update: {
      name: 'B6 deterministic launch fixture',
      status: 'DRAFT',
      snapshotHash: null,
      approvedByUserId: null,
      approvedAt: null,
      retiredAt: null,
      createdByUserId: admin.id,
    },
    create: {
      version: launchVersion,
      name: 'B6 deterministic launch fixture',
      status: 'DRAFT',
      createdByUserId: admin.id,
    },
  });

  await prisma.commercialLaunchItem.deleteMany({
    where: { matrixId: matrix.id },
  });
  await prisma.commercialLaunchOffering.deleteMany({
    where: { matrixId: matrix.id },
  });
  await prisma.commercialLaunchPolicy.deleteMany({
    where: { matrixId: matrix.id },
  });

  const launchItems = [
    ['surface.core', 'SURFACE', 'LAUNCH', null],
    ['surface.web', 'SURFACE', 'LAUNCH', null],
    ['service.email', 'CHANNEL', 'LAUNCH', null],
    ['service.billing', 'CHANNEL', 'LAUNCH', null],
    ['content.external_youtube', 'CAPABILITY', 'LAUNCH', 'content.external_youtube'],
    ['mobile.android', 'MOBILE', 'OUT', null],
    ['mobile.ios', 'MOBILE', 'OUT', null],
    ['ai.workout_generation', 'CAPABILITY', 'LAUNCH', 'ai.workout_generation'],
    ['ai.content_recommendation', 'CAPABILITY', 'LAUNCH', 'ai.content_recommendation'],
    ['creator.iron_managed', 'CAPABILITY', 'OUT', 'content.iron_managed'],
    ['creator.tenant_private', 'CAPABILITY', 'OUT', 'content.tenant_private'],
    ['provider.wellhub', 'PROVIDER', 'OUT', 'aggregator.wellhub'],
    ['provider.totalpass', 'PROVIDER', 'OUT', 'aggregator.totalpass'],
    ['channel.meta', 'CHANNEL', 'OUT', null],
    ['channel.google', 'CHANNEL', 'OUT', null],
  ];

  for (const [itemKey, kind, decision, featureKey] of launchItems) {
    await prisma.commercialLaunchItem.create({
      data: {
        matrixId: matrix.id,
        itemKey,
        kind,
        decision,
        featureKey,
        rationale:
          decision === 'OUT'
            ? 'B6 deterministic fixture excludes optional external surface'
            : null,
      },
    });
  }

  for (const price of [basicPrice, proPrice]) {
    await prisma.commercialLaunchOffering.create({
      data: {
        matrixId: matrix.id,
        planVersionId: price.planVersionId,
        priceId: price.id,
      },
    });
  }

  await prisma.commercialLaunchPolicy.create({
    data: {
      matrixId: matrix.id,
      trialEnabled: true,
      trialPlanVersionId: trial.version.id,
      trialDays: 14,
      invoiceDueDays: 3,
      dunningGraceDays: 5,
      upgradePolicy: 'IMMEDIATE_PRORATED',
      downgradePolicy: 'NEXT_PERIOD_NO_IMMEDIATE_REFUND',
      cancellationPolicy: 'IMMEDIATE_OR_PERIOD_END',
      refundPolicy: 'SUPER_ADMIN_MANUAL',
      fiscalMode: 'OUT',
    },
  });

  const frozen = await prisma.commercialLaunchMatrix.findUniqueOrThrow({
    where: { id: matrix.id },
    include: {
      items: { orderBy: { itemKey: 'asc' } },
      offerings: { orderBy: { priceId: 'asc' } },
      policy: true,
    },
  });
  const prices = await prisma.saasPlanPrice.findMany({
    where: { id: { in: frozen.offerings.map((item) => item.priceId) } },
    include: {
      planVersion: { include: { productPlan: true } },
    },
  });
  const byPrice = new Map(prices.map((price) => [price.id, price]));
  const iso = (value) => value ? value.toISOString() : null;
  const snapshot = {
    version: frozen.version,
    name: frozen.name,
    items: frozen.items.map((item) => ({
      itemKey: item.itemKey,
      kind: item.kind,
      decision: item.decision,
      featureKey: item.featureKey,
      rationale: item.rationale,
      blockerOwner: item.blockerOwner,
      evidenceRequirement: item.evidenceRequirement,
    })),
    offerings: frozen.offerings.map((offering) => {
      const price = byPrice.get(offering.priceId);
      if (!price) throw new Error('B6 launch fixture price missing');
      return {
        priceId: price.id,
        priceCode: price.priceCode,
        planVersionId: price.planVersionId,
        planCode: price.planVersion.productPlan.code,
        planVersion: price.planVersion.version,
        currency: price.currency,
        amountMinor: price.amountMinor,
        interval: price.interval,
        effectiveFrom: iso(price.effectiveFrom),
        effectiveUntil: iso(price.effectiveUntil),
      };
    }),
    policy: {
      trialEnabled: frozen.policy.trialEnabled,
      trialPlanVersionId: frozen.policy.trialPlanVersionId,
      trialDays: frozen.policy.trialDays,
      invoiceDueDays: frozen.policy.invoiceDueDays,
      dunningGraceDays: frozen.policy.dunningGraceDays,
      upgradePolicy: frozen.policy.upgradePolicy,
      downgradePolicy: frozen.policy.downgradePolicy,
      cancellationPolicy: frozen.policy.cancellationPolicy,
      refundPolicy: frozen.policy.refundPolicy,
      fiscalMode: frozen.policy.fiscalMode,
    },
  };
  const snapshotHash = createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');

  await prisma.commercialLaunchMatrix.update({
    where: { id: matrix.id },
    data: {
      status: 'APPROVED',
      snapshotHash,
      approvedByUserId: admin.id,
      approvedAt: new Date(),
    },
  });

  process.stdout.write(JSON.stringify({
    event: 'b6_seed_ready',
    trialPlanVersionId: trial.version.id,
    basicPlanVersionId: basic.version.id,
    proPlanVersionId: pro.version.id,
    launchMatrixId: matrix.id,
    launchSnapshotHash: snapshotHash,
    adminEmail: admin.email,
  }) + '\n');
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
