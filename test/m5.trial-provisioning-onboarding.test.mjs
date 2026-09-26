import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Prisma } = require('@prisma/client');

async function source(path) {
  return readFile(path, 'utf8');
}

function makeHarness(overrides = {}) {
  const { CommercialTrialService } = require(
    '../dist/src/modules/commercial/commercial-trial.service.js',
  );

  let requestRaceTriggered = false;
  let externalWinner = null;

  const state = {
    users: new Map(),
    gyms: new Map(),
    provisionings: new Map(),
    subscriptions: new Map(),
    audits: [],
    onboarding: [],
    checkpoints: [],
    creates: { user: 0, gym: 0, subscription: 0 },
    subscriptionActive: true,
  };

  const ownerRole = overrides.ownerMissing ? null : { id: 'role-owner', name: 'OWNER' };
  const planVersion = overrides.planMissing
    ? null
    : { id: 'pv-trial', version: 1, status: 'PUBLISHED', productPlan: { code: 'IRON_TRIAL' } };

  const auditLog = {
    create: async ({ data }) => {
      state.audits.push(data);
      return { id: `audit-${state.audits.length}`, ...data };
    },
  };

  const tx = {
    commercialTrialProvisioning: {
      findUnique: async ({ where }) => state.provisionings.get(where.requestId) ?? null,
      create: async ({ data }) => {
        if (overrides.requestIdRace && !requestRaceTriggered) {
          requestRaceTriggered = true;
          externalWinner = {
            ...data,
            userId: 'winner-user',
            gymId: 'winner-gym',
            subscriptionId: 'winner-sub',
          };
          throw new Prisma.PrismaClientKnownRequestError('requestId race', {
            code: 'P2002',
            clientVersion: '6.19.3',
          });
        }
        if (state.provisionings.has(data.requestId)) {
          throw new Prisma.PrismaClientKnownRequestError('duplicate requestId', {
            code: 'P2002',
            clientVersion: '6.19.3',
          });
        }
        state.provisionings.set(data.requestId, data);
        return data;
      },
    },
    user: {
      findUnique: async ({ where }) => state.users.get(where.email) ?? null,
      create: async ({ data }) => {
        if (overrides.emailRace) {
          throw new Prisma.PrismaClientKnownRequestError('email race', {
            code: 'P2002',
            clientVersion: '6.19.3',
          });
        }
        state.creates.user += 1;
        const user = { id: `user-${state.creates.user}`, ...data };
        state.users.set(data.email, user);
        return user;
      },
    },
    gym: {
      findUnique: async ({ where }) => {
        if (where.slug) return [...state.gyms.values()].find((gym) => gym.slug === where.slug) ?? null;
        return state.gyms.get(where.id) ?? null;
      },
      create: async ({ data }) => {
        state.creates.gym += 1;
        const gym = { id: `gym-${state.creates.gym}`, active: true, ...data };
        state.gyms.set(gym.id, gym);
        return gym;
      },
      update: async ({ where, data }) => {
        const current = state.gyms.get(where.id);
        const updated = { ...current, ...data };
        state.gyms.set(where.id, updated);
        return updated;
      },
    },
    role: { findUnique: async () => ownerRole },
    productPlanVersion: { findFirst: async () => planVersion },
    userRole: { create: async ({ data }) => data },
    tenantProductSubscription: {
      create: async ({ data }) => {
        state.creates.subscription += 1;
        const record = { id: `sub-${state.creates.subscription}`, ...data };
        state.subscriptions.set(record.id, record);
        return record;
      },
      updateMany: async ({ where, data }) => {
        const current = state.subscriptions.get(where.id);
        if (!current || current.status !== 'ACTIVE') return { count: 0 };
        state.subscriptions.set(where.id, { ...current, ...data });
        state.subscriptionActive = data.status === 'ACTIVE';
        return { count: 1 };
      },
    },
    commercialOnboardingCheckpoint: {
      findMany: async ({ where }) =>
        state.checkpoints.filter((checkpoint) => checkpoint.gymId === where.gymId),
      create: async ({ data }) => {
        if (state.checkpoints.some((checkpoint) =>
          checkpoint.gymId === data.gymId && checkpoint.step === data.step
        )) {
          throw new Error('duplicate onboarding step');
        }
        const record = {
          id: `checkpoint-${state.checkpoints.length + 1}`,
          completedAt: new Date(),
          ...data,
        };
        state.checkpoints.push(record);
        return record;
      },
    },
    auditLog,
  };

  const prisma = {
    ...tx,
    tenantProductSubscription: {
      ...tx.tenantProductSubscription,
      findFirst: async () => {
        if (!state.subscriptionActive) return null;
        return overrides.expiringSubscription ?? null;
      },
    },
    $transaction: async (operation, options) => {
      assert.equal(options?.isolationLevel, 'Serializable');
      const snapshot = {
        users: new Map(state.users),
        gyms: new Map(state.gyms),
        provisionings: new Map(state.provisionings),
        subscriptions: new Map(state.subscriptions),
        audits: [...state.audits],
        checkpoints: [...state.checkpoints],
        creates: { ...state.creates },
        subscriptionActive: state.subscriptionActive,
      };
      try {
        return await operation(tx);
      } catch (error) {
        state.users = snapshot.users;
        state.gyms = snapshot.gyms;
        state.provisionings = snapshot.provisionings;
        state.subscriptions = snapshot.subscriptions;
        state.audits = snapshot.audits;
        state.checkpoints = snapshot.checkpoints;
        state.creates = snapshot.creates;
        state.subscriptionActive = snapshot.subscriptionActive;
        if (externalWinner) {
          state.provisionings.set(externalWinner.requestId, externalWinner);
          externalWinner = null;
        }
        throw error;
      }
    },
  };

  const config = {
    get: (key) => {
      if (key === 'IRON_FIT_TRIAL_PLAN_CODE') return overrides.planCode ?? 'IRON_TRIAL';
      if (key === 'IRON_FIT_TRIAL_DAYS') return overrides.trialDays ?? '14';
      return undefined;
    },
  };

  const audit = {
    record: async (entry, db = prisma) => {
      if (overrides.auditFailure) throw new Error('audit unavailable');
      return db.auditLog.create({ data: entry });
    },
  };

  return { service: new CommercialTrialService(prisma, config, audit), state };
}

const dto = {
  requestId: '11111111-1111-4111-8111-111111111111',
  email: ' OWNER@EXAMPLE.COM ',
  password: 'ExamplePass123!',
  name: 'Owner Example',
  phone: '11999999999',
  gymName: 'Academia Alpha',
  timezone: 'America/Sao_Paulo',
};

test('M5 controller derives tenant from authenticated identity and restricts onboarding roles', async () => {
  const controller = await source('src/modules/commercial/commercial-trial.controller.ts');
  assert.match(controller, /@Post\('trial\/start'\)/);
  assert.match(controller, /@Roles\('OWNER', 'MANAGER'\)/);
  assert.match(controller, /user\?\.activeGymId \?\? user\?\.gymId/);
  assert.equal(controller.includes('dto.gymId'), false);
});

test('M5 requestId has a physical idempotency authority independent of AuditLog', async () => {
  const service = await source('src/modules/commercial/commercial-trial.service.ts');
  const schema = await source('prisma/schema.prisma');
  const migration = await source(
    'prisma/migrations/20260925233500_commercial_trial_provisioning_idempotency/migration.sql',
  );
  assert.match(service, /commercialTrialProvisioning\.findUnique/);
  assert.match(service, /commercialTrialProvisioning\.create/);
  assert.equal(service.includes('auditLog.findFirst'), false);
  assert.match(schema, /model CommercialTrialProvisioning/);
  assert.match(schema, /requestId\s+String\s+@id/);
  assert.match(migration, /PRIMARY KEY \("requestId"\)/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
});

test('M5 happy provisioning normalizes email, hashes password and creates one tenant/subscription/audit', async () => {
  const { service, state } = makeHarness();
  const result = await service.startTrial(dto);
  assert.equal(result.idempotentReplay, false);
  assert.equal(state.creates.user, 1);
  assert.equal(state.creates.gym, 1);
  assert.equal(state.creates.subscription, 1);
  assert.equal(state.provisionings.size, 1);
  const user = [...state.users.values()][0];
  assert.equal(user.email, 'owner@example.com');
  assert.notEqual(user.passwordHash, dto.password);
  assert.equal(JSON.stringify([...state.provisionings.values()]).includes(dto.password), false);
  assert.equal(JSON.stringify(state.audits).includes(dto.password), false);
});

test('M5 replay returns the canonical provisioning without duplicate resources', async () => {
  const { service, state } = makeHarness();
  const first = await service.startTrial(dto);
  const replay = await service.startTrial(dto);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.userId, first.userId);
  assert.equal(replay.gymId, first.gymId);
  assert.equal(replay.subscriptionId, first.subscriptionId);
  assert.equal(state.creates.user, 1);
  assert.equal(state.creates.gym, 1);
  assert.equal(state.creates.subscription, 1);
});

test('M5 concurrent requestId loser rolls back and replays the external canonical winner', async () => {
  const { service, state } = makeHarness({ requestIdRace: true });
  const result = await service.startTrial(dto);

  assert.equal(result.idempotentReplay, true);
  assert.equal(result.userId, 'winner-user');
  assert.equal(result.gymId, 'winner-gym');
  assert.equal(result.subscriptionId, 'winner-sub');
  assert.equal(state.users.size, 0);
  assert.equal(state.gyms.size, 0);
  assert.equal(state.subscriptions.size, 0);
  assert.equal(state.audits.length, 0);
});

test('M5 terminal concurrent email uniqueness conflict is normalized and leaves no partial provisioning', async () => {
  const { service, state } = makeHarness({ emailRace: true });

  await assert.rejects(
    () => service.startTrial(dto),
    /Cadastro indisponivel para estes dados/,
  );
  assert.equal(state.users.size, 0);
  assert.equal(state.gyms.size, 0);
  assert.equal(state.provisionings.size, 0);
  assert.equal(state.subscriptions.size, 0);
  assert.equal(state.audits.length, 0);
});

test('M5 rolls back every provisioning resource when the atomic audit fails', async () => {
  const { service, state } = makeHarness({ auditFailure: true });

  await assert.rejects(
    () => service.startTrial(dto),
    /audit unavailable/,
  );

  assert.equal(state.users.size, 0);
  assert.equal(state.gyms.size, 0);
  assert.equal(state.provisionings.size, 0);
  assert.equal(state.subscriptions.size, 0);
  assert.equal(state.audits.length, 0);
});

test('M5 rejects idempotency-key reuse with different business data', async () => {
  const { service } = makeHarness();
  await service.startTrial(dto);
  await assert.rejects(
    () => service.startTrial({ ...dto, gymName: 'Outra Academia' }),
    /Chave de idempotencia reutilizada com dados diferentes/,
  );
});

test('M5 duplicate signup is non-enumerating and configuration dependencies fail closed', async () => {
  const duplicate = makeHarness();
  duplicate.state.users.set('owner@example.com', { id: 'existing' });
  await assert.rejects(
    () => duplicate.service.startTrial(dto),
    /Cadastro indisponivel para estes dados/,
  );
  await assert.rejects(
    () => makeHarness({ trialDays: '0' }).service.startTrial(dto),
    /Trial comercial nao configurado/,
  );
  await assert.rejects(
    () => makeHarness({ ownerMissing: true }).service.startTrial(dto),
    /RBAC OWNER nao configurado/,
  );
  await assert.rejects(
    () => makeHarness({ planMissing: true }).service.startTrial(dto),
    /Plano de trial PUBLISHED nao configurado/,
  );
  await assert.rejects(
    () => makeHarness().service.startTrial({ ...dto, timezone: 'America/Invalid_Zone' }),
    /Timezone invalido/,
  );
  const argentina = await makeHarness().service.startTrial({
    ...dto,
    requestId: '22222222-2222-4222-8222-222222222222',
    email: 'argentina@example.com',
    timezone: 'America/Argentina/Buenos_Aires',
  });
  assert.equal(argentina.idempotentReplay, false);

  const dtoSource = await source('src/modules/commercial/dto/start-trial.dto.ts');
  assert.equal(dtoSource.includes('@Matches('), false);
});

test('M5 onboarding is ordered, replay-safe and transaction-scoped', async () => {
  const { service, state } = makeHarness();
  state.gyms.set('gym-a', {
    id: 'gym-a',
    name: 'Academia A',
    slug: 'academia-a',
    timezone: 'America/Sao_Paulo',
    active: true,
  });

  await assert.rejects(
    () => service.updateOnboarding('gym-a', 'owner-a', { step: 'TEAM_REVIEW' }),
    /Etapas anteriores/,
  );

  let status = await service.updateOnboarding('gym-a', 'owner-a', {
    step: 'ACADEMY_PROFILE',
    data: { name: 'Academia Nova', timezone: 'America/Sao_Paulo' },
  });
  assert.equal(status.nextStep, 'EQUIPMENT_INVENTORY');

  const replay = await service.updateOnboarding('gym-a', 'owner-a', {
    step: 'ACADEMY_PROFILE',
    data: { name: 'Nao deve sobrescrever', timezone: 'America/Sao_Paulo' },
  });
  assert.equal(replay.nextStep, 'EQUIPMENT_INVENTORY');

  for (const step of ['EQUIPMENT_INVENTORY', 'TEAM_REVIEW', 'FINISH']) {
    status = await service.updateOnboarding('gym-a', 'owner-a', { step });
  }

  assert.equal(status.status, 'COMPLETED');
  assert.equal(status.nextStep, null);
  assert.equal(state.audits.filter((a) => a.action === 'COMMERCIAL_ONBOARDING_STEP_COMPLETED').length, 4);

  const serviceSource = await source('src/modules/commercial/commercial-trial.service.ts');
  const schema = await source('prisma/schema.prisma');
  assert.match(serviceSource, /completedSteps\(gymId, tx\)/);
  assert.match(serviceSource, /commercialOnboardingCheckpoint\.create/);
  assert.equal(serviceSource.includes('auditLog.findMany'), false);
  assert.match(schema, /@@unique\(\[gymId, step\]\)/);
});

test('M5 bounded non-trial subscription is not mislabeled or suspended as trial', async () => {
  const paid = {
    id: 'sub-paid',
    status: 'ACTIVE',
    effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
    effectiveUntil: new Date('2026-09-02T00:00:00.000Z'),
    planVersion: { productPlan: { code: 'IRON_PRO' } },
  };
  const { service, state } = makeHarness({ expiringSubscription: paid });
  state.subscriptions.set(paid.id, paid);
  const result = await service.synchronizeTrial('gym-a', 'owner-a');
  assert.equal(result.status, 'ACTIVE');
  assert.equal(state.audits.filter((a) => a.action === 'COMMERCIAL_TRIAL_EXPIRED').length, 0);
});

test('M5 expiration is materialized once while entitlements fail closed by effective window', async () => {
  const expired = {
    id: 'sub-expired',
    status: 'ACTIVE',
    effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
    effectiveUntil: new Date('2026-09-02T00:00:00.000Z'),
    planVersion: { productPlan: { code: 'IRON_TRIAL' } },
  };
  const { service, state } = makeHarness({ expiringSubscription: expired });
  state.subscriptions.set(expired.id, expired);

  const first = await service.synchronizeTrial('gym-a', 'owner-a');
  const second = await service.synchronizeTrial('gym-a', 'owner-a');
  assert.equal(first.status, 'EXPIRED');
  assert.equal(first.changed, true);
  assert.equal(second.status, 'INACTIVE');
  assert.equal(state.audits.filter((a) => a.action === 'COMMERCIAL_TRIAL_EXPIRED').length, 1);

  const entitlements = await source(
    'src/modules/product-entitlements/tenant-product-entitlements.service.ts',
  );
  const jwt = await source('src/modules/auth/strategies/jwt.strategy.ts');
  assert.match(entitlements, /effectiveFrom: \{ lte: new Date\(\) \}/);
  assert.match(entitlements, /effectiveUntil: \{ gt: new Date\(\) \}/);
  assert.equal(jwt.includes('COMMERCIAL_TRIAL_EXPIRED'), false);
  assert.equal(jwt.includes('tenantProductSubscription'), false);
});

test('M5 CI gates implementation branches and retains the complete canonical quality pipeline', async () => {
  const workflow = await source('.github/workflows/iron-s0-quality.yml');
  assert.match(workflow, /'stabilization\/\*\*'/);
  assert.match(workflow, /'feat\/\*\*'/);
  assert.match(workflow, /'fix\/\*\*'/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /npx prisma generate/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm run test:smoke/);
});
