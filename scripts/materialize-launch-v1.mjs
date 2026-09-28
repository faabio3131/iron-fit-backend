import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/src/app.module.js');
const { PrismaService } = require('../dist/src/prisma/prisma.service.js');
const { ProductEntitlementsService } = require(
  '../dist/src/modules/product-entitlements/product-entitlements.service.js',
);
const { SaasBillingService } = require(
  '../dist/src/modules/saas-billing/saas-billing.service.js',
);
const { CommercialLaunchService } = require(
  '../dist/src/modules/commercial-launch/commercial-launch.service.js',
);

const manifestPath =
  process.env.IRON_LAUNCH_MANIFEST_PATH ??
  new URL('../config/commercial/iron-v1-launch.json', import.meta.url);

function canonicalEntitlement(entry) {
  return {
    featureKey: entry.featureKey,
    featureEnabled:
      typeof entry.featureEnabled === 'boolean' ? entry.featureEnabled : null,
    limitValue: Number.isInteger(entry.limitValue) ? entry.limitValue : null,
    policyValues: Array.isArray(entry.policyValues)
      ? [...entry.policyValues].sort()
      : null,
  };
}

function assertManifest(manifest) {
  if (manifest?.schemaVersion !== 1) {
    throw new Error('Launch manifest schemaVersion deve ser 1');
  }
  if (!Number.isInteger(manifest?.matrix?.version) || manifest.matrix.version < 1) {
    throw new Error('Launch manifest exige matrix.version positivo');
  }
  if (!Array.isArray(manifest.plans) || manifest.plans.length < 2) {
    throw new Error('Launch manifest exige planos de trial e oferta paga');
  }
  if (!Array.isArray(manifest.launchItems) || manifest.launchItems.length === 0) {
    throw new Error('Launch manifest exige launchItems');
  }
  if (!Array.isArray(manifest.offerings) || manifest.offerings.length === 0) {
    throw new Error('Launch manifest exige offerings');
  }
  if (manifest.policy?.trialEnabled !== true) {
    throw new Error('IRON V1 exige trial habilitado');
  }
  if (manifest.policy.trialDays !== 30) {
    throw new Error('IRON V1 exige trial de 30 dias');
  }
  if (
    manifest.policy.invoiceDueDays !== 0 ||
    manifest.policy.dunningGraceDays !== 7
  ) {
    throw new Error('IRON V1 exige billing 0/7');
  }

  const itemMap = new Map(manifest.launchItems.map((item) => [item.itemKey, item]));
  for (const requiredLaunch of [
    'mobile.android',
    'mobile.ios',
    'ai.workout_generation',
    'ai.content_recommendation',
    'channel.meta',
    'channel.google',
  ]) {
    if (itemMap.get(requiredLaunch)?.decision !== 'LAUNCH') {
      throw new Error(requiredLaunch + ' deve ser LAUNCH no manifesto IRON V1');
    }
  }
  for (const blocked of ['provider.wellhub', 'provider.totalpass']) {
    if (itemMap.get(blocked)?.decision !== 'EXTERNAL_BLOCKER') {
      throw new Error(blocked + ' deve permanecer EXTERNAL_BLOCKER');
    }
  }
  for (const out of ['creator.iron_managed', 'creator.tenant_private']) {
    if (itemMap.get(out)?.decision !== 'OUT') {
      throw new Error(out + ' deve permanecer OUT no V1');
    }
  }

  const trial = manifest.plans.find(
    (plan) =>
      plan.code === manifest.policy.trialPlan.planCode &&
      plan.version === manifest.policy.trialPlan.version,
  );
  if (!trial) throw new Error('Plano de trial referenciado nao existe no manifesto');
  const cap = trial.entitlements.find(
    (entry) => entry.featureKey === 'commercial.trial_students_max',
  );
  if (cap?.limitValue !== 15) {
    throw new Error('Plano de trial deve limitar alunos a 15');
  }

  if (manifest.policy.fiscalMode !== 'PROVIDER_NFSE') {
    throw new Error('Fiscal V1 deve usar PROVIDER_NFSE');
  }
}

async function readManifest() {
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  assertManifest(manifest);
  return manifest;
}

async function assertActor(prisma) {
  const email = process.env.IRON_LAUNCH_ACTOR_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error(
      'IRON_LAUNCH_ACTOR_EMAIL obrigatorio; materializacao comercial exige SUPER_ADMIN identificavel',
    );
  }
  const actor = await prisma.user.findUnique({
    where: { email },
    include: { userRoles: { include: { role: true } } },
  });
  if (
    !actor ||
    !actor.active ||
    !actor.userRoles.some(
      (assignment) =>
        assignment.gymId === null && assignment.role?.name === 'SUPER_ADMIN',
    )
  ) {
    throw new Error('IRON_LAUNCH_ACTOR_EMAIL deve pertencer a SUPER_ADMIN global ativo');
  }
  return actor;
}

async function ensurePlan({
  manifestPlan,
  actor,
  prisma,
  entitlements,
  billing,
}) {
  const plan = await entitlements.createPlan(
    {
      code: manifestPlan.code,
      name: manifestPlan.name,
      description: manifestPlan.description,
    },
    actor.id,
  );
  const version = await entitlements.createVersion(
    plan.id,
    { version: manifestPlan.version },
    actor.id,
  );

  if (version.status === 'DRAFT') {
    for (const entitlement of manifestPlan.entitlements) {
      await entitlements.setEntitlement(
        plan.id,
        manifestPlan.version,
        entitlement,
        actor.id,
      );
    }
    await entitlements.publishVersion(plan.id, manifestPlan.version, actor.id);
  } else if (version.status === 'PUBLISHED') {
    const stored = await prisma.productPlanVersion.findUniqueOrThrow({
      where: { id: version.id },
      include: { entitlements: { orderBy: { featureKey: 'asc' } } },
    });
    const expected = manifestPlan.entitlements
      .map(canonicalEntitlement)
      .sort((a, b) => a.featureKey.localeCompare(b.featureKey));
    const actual = stored.entitlements
      .map(canonicalEntitlement)
      .sort((a, b) => a.featureKey.localeCompare(b.featureKey));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        'ProductPlanVersion PUBLISHED diverge do manifesto: ' +
          manifestPlan.code +
          ' v' +
          manifestPlan.version,
      );
    }
  } else {
    throw new Error(
      'ProductPlanVersion RETIRED nao pode materializar launch: ' +
        manifestPlan.code,
    );
  }

  const published = await prisma.productPlanVersion.findFirstOrThrow({
    where: {
      productPlanId: plan.id,
      version: manifestPlan.version,
      status: 'PUBLISHED',
    },
    include: { productPlan: true },
  });

  const prices = [];
  for (const price of manifestPlan.prices) {
    prices.push(
      await billing.createPrice(
        {
          priceCode: price.priceCode,
          planCode: manifestPlan.code,
          version: manifestPlan.version,
          currency: price.currency,
          amountMinor: price.amountMinor,
          interval: price.interval,
        },
        actor.id,
      ),
    );
  }
  return { plan, version: published, prices };
}

async function main() {
  const manifest = await readManifest();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const prisma = app.get(PrismaService);
    const entitlements = app.get(ProductEntitlementsService);
    const billing = app.get(SaasBillingService);
    const launch = app.get(CommercialLaunchService);
    const actor = await assertActor(prisma);

    const materializedPlans = new Map();
    for (const manifestPlan of manifest.plans) {
      const result = await ensurePlan({
        manifestPlan,
        actor,
        prisma,
        entitlements,
        billing,
      });
      materializedPlans.set(manifestPlan.code, result);
    }

    const matrix = await launch.create(
      {
        version: manifest.matrix.version,
        name: manifest.matrix.name,
      },
      actor.id,
    );

    for (const item of manifest.launchItems) {
      await launch.upsertItem(matrix.id, item, actor.id);
    }

    const currentAfterItems = (await launch.list()).find(
      (candidate) => candidate.id === matrix.id,
    );
    if (!currentAfterItems) throw new Error('Launch Matrix materializada nao encontrada');

    const desiredItemKeys = new Set(manifest.launchItems.map((item) => item.itemKey));
    for (const item of currentAfterItems.items) {
      if (!desiredItemKeys.has(item.itemKey)) {
        await launch.removeItem(matrix.id, item.itemKey, actor.id);
      }
    }

    const desiredPriceIds = new Set();
    for (const offering of manifest.offerings) {
      const planResult = materializedPlans.get(offering.planCode);
      if (
        !planResult ||
        planResult.version.version !== offering.version
      ) {
        throw new Error('Offering referencia ProductPlanVersion inexistente');
      }
      const price = await prisma.saasPlanPrice.findUniqueOrThrow({
        where: { priceCode: offering.priceCode },
      });
      if (price.planVersionId !== planResult.version.id) {
        throw new Error('Offering referencia preco de outro ProductPlanVersion');
      }
      desiredPriceIds.add(price.id);
      await launch.addOffering(
        matrix.id,
        { priceId: price.id },
        actor.id,
      );
    }

    const currentAfterOfferings = (await launch.list()).find(
      (candidate) => candidate.id === matrix.id,
    );
    if (!currentAfterOfferings) throw new Error('Launch Matrix materializada nao encontrada');
    for (const offering of currentAfterOfferings.offerings) {
      if (!desiredPriceIds.has(offering.priceId)) {
        await launch.removeOffering(matrix.id, offering.priceId, actor.id);
      }
    }

    const trialPlan = materializedPlans.get(manifest.policy.trialPlan.planCode);
    if (
      !trialPlan ||
      trialPlan.version.version !== manifest.policy.trialPlan.version
    ) {
      throw new Error('Plano de trial materializado diverge do manifesto');
    }

    await launch.setPolicy(
      matrix.id,
      {
        trialEnabled: true,
        trialPlanVersionId: trialPlan.version.id,
        trialDays: manifest.policy.trialDays,
        invoiceDueDays: manifest.policy.invoiceDueDays,
        dunningGraceDays: manifest.policy.dunningGraceDays,
        upgradePolicy: manifest.policy.upgradePolicy,
        downgradePolicy: manifest.policy.downgradePolicy,
        cancellationPolicy: manifest.policy.cancellationPolicy,
        refundPolicy: manifest.policy.refundPolicy,
        fiscalMode: manifest.policy.fiscalMode,
      },
      actor.id,
    );

    const validation = await launch.validateDraft(matrix.id);
    process.stdout.write(
      JSON.stringify({
        event: 'iron_v1_launch_draft_materialized',
        matrixId: matrix.id,
        version: matrix.version,
        status: 'DRAFT',
        actorUserId: actor.id,
        readyToApprove: validation.readyToApprove,
        candidateSnapshotHash: validation.candidateSnapshotHash,
        itemCount: validation.itemCount,
        offeringCount: validation.offeringCount,
        approvalPerformed: false,
      }) + '\n',
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
