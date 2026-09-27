import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

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

  await prisma.saasPlanPrice.upsert({
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

  await prisma.saasPlanPrice.upsert({
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

  process.stdout.write(JSON.stringify({
    event: 'b6_seed_ready',
    trialPlanVersionId: trial.version.id,
    basicPlanVersionId: basic.version.id,
    proPlanVersionId: pro.version.id,
    adminEmail: admin.email,
  }) + '\n');
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
