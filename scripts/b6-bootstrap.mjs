import { PrismaClient, ProductEntitlementKind, ProductPlanVersionStatus } from '@prisma/client';

const prisma = new PrismaClient();

const featureKeys = [
  'equipment.catalog',
  'equipment.inventory',
  'ai.workout_generation',
  'content.external_youtube',
  'content.iron_managed',
  'content.tenant_private',
  'analytics.aggregator',
];

async function upsertPlan(code, name, version = 1) {
  const plan = await prisma.productPlan.upsert({
    where: { code },
    update: { name },
    create: { code, name },
  });

  const planVersion = await prisma.productPlanVersion.upsert({
    where: { productPlanId_version: { productPlanId: plan.id, version } },
    update: {
      status: ProductPlanVersionStatus.PUBLISHED,
      publishedAt: new Date(),
      retiredAt: null,
    },
    create: {
      productPlanId: plan.id,
      version,
      status: ProductPlanVersionStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });

  for (const featureKey of featureKeys) {
    await prisma.productPlanEntitlement.upsert({
      where: { planVersionId_featureKey: { planVersionId: planVersion.id, featureKey } },
      update: {
        kind: ProductEntitlementKind.FEATURE,
        featureEnabled: true,
        limitValue: null,
        policyValues: undefined,
      },
      create: {
        planVersionId: planVersion.id,
        featureKey,
        kind: ProductEntitlementKind.FEATURE,
        featureEnabled: true,
      },
    });
  }

  return { plan, planVersion };
}

async function main() {
  await upsertPlan('IRON_TRIAL', 'IRON Trial');
  await upsertPlan('IRON_BASIC', 'IRON Basic');
  await upsertPlan('IRON_PRO', 'IRON Pro');
  await upsertPlan('IRON_PRO_PLUS', 'IRON Pro Plus');

  process.stdout.write(JSON.stringify({ event: 'b6_bootstrap_ready' }) + '\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
