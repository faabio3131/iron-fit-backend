import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { StudentsService } = require('../dist/src/modules/students/students.service.js');

function studentRole() {
  return { id: 'role-student', name: 'STUDENT' };
}

function auditMock() {
  return {
    record: async () => ({ id: 'audit-test' }),
  };
}

function entitlementsMock(limit = 15) {
  return {
    resolveFeature: async () => ({
      featureKey: 'commercial.trial_students_max',
      kind: 'LIMIT',
      value: limit,
      source: 'PLAN_ENTITLEMENT',
    }),
  };
}

test('student service no longer contains the fixed aluno123 credential', async () => {
  const source = await readFile('src/modules/students/students.service.ts', 'utf8');
  assert.equal(source.includes("bcrypt.hash('aluno123'"), false);
  assert.equal(source.includes('STUDENT_ONBOARDING'), true);
});

test('existing active user is reused instead of creating a duplicate User', async () => {
  let userCreateCalls = 0;
  let roleCreateCalls = 0;
  const existingUser = {
    id: 'user-existing',
    email: 'aluno@example.com',
    name: 'Aluno Existente',
    phone: null,
    active: true,
  };

  const tx = {
    user: {
      create: async () => {
        userCreateCalls += 1;
        throw new Error('duplicate user must not be created');
      },
    },
    userRole: {
      findFirst: async () => null,
      create: async () => {
        roleCreateCalls += 1;
        return { id: 'ur-1' };
      },
    },
    student: {
      create: async ({ data }) => ({
        id: 'student-1',
        ...data,
        status: 'ACTIVE',
        enrollmentDate: new Date('2026-09-03T00:00:00Z'),
        user: existingUser,
      }),
    },
    session: {
      updateMany: async () => ({ count: 0 }),
      create: async () => {
        throw new Error('active existing user must not receive onboarding invite');
      },
    },
  };

  const prisma = {
    gym: { findFirst: async () => ({ id: 'gym-a', active: true }) },
    student: { findFirst: async () => null },
    user: { findUnique: async () => existingUser },
    role: { findUnique: async () => studentRole() },
    commercialTrialProvisioning: { findFirst: async () => null },
    $transaction: async (callback) => callback(tx),
  };

  const service = new StudentsService(prisma, auditMock(), entitlementsMock());
  const result = await service.create(
    { name: 'Outro Nome', email: existingUser.email },
    'gym-a',
  );

  assert.equal(userCreateCalls, 0);
  assert.equal(roleCreateCalls, 1);
  assert.equal(result.onboarding.required, false);
  assert.equal(result.email, existingUser.email);
});

test('new student receives a random one-time onboarding token and starts inactive', async () => {
  let createdUserData;
  let createdSessionData;

  const tx = {
    user: {
      create: async ({ data }) => {
        createdUserData = data;
        return {
          id: 'user-new',
          email: data.email,
          name: data.name,
          phone: data.phone ?? null,
          active: data.active,
        };
      },
    },
    userRole: {
      findFirst: async () => null,
      create: async () => ({ id: 'ur-new' }),
    },
    student: {
      create: async ({ data }) => ({
        id: 'student-new',
        ...data,
        status: 'ACTIVE',
        enrollmentDate: new Date('2026-09-03T00:00:00Z'),
        user: {
          id: data.userId,
          email: 'novo@example.com',
          name: 'Novo Aluno',
          phone: null,
        },
      }),
    },
    session: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }) => {
        createdSessionData = data;
        return { id: 'invite-session', ...data };
      },
    },
  };

  const prisma = {
    gym: { findFirst: async () => ({ id: 'gym-a', active: true }) },
    student: { findFirst: async () => null },
    user: { findUnique: async () => null },
    role: { findUnique: async () => studentRole() },
    commercialTrialProvisioning: { findFirst: async () => null },
    $transaction: async (callback) => callback(tx),
  };

  const service = new StudentsService(prisma, auditMock(), entitlementsMock());
  const result = await service.create(
    { name: 'Novo Aluno', email: 'novo@example.com' },
    'gym-a',
  );

  assert.equal(createdUserData.active, false);
  assert.equal(typeof createdUserData.passwordHash, 'string');
  assert.equal(result.onboarding.required, true);
  assert.ok(result.onboarding.token.length >= 32);
  assert.equal(createdSessionData.deviceName, 'STUDENT_ONBOARDING');
  assert.notEqual(createdSessionData.refreshTokenHash, result.onboarding.token);
  assert.match(createdSessionData.refreshTokenHash, /^[a-f0-9]{64}$/);
});

test('cross-tenant gymId in student payload is rejected', async () => {
  const service = new StudentsService({}, auditMock(), entitlementsMock());

  await assert.rejects(
    () => service.create({ gymId: 'gym-b', name: 'A', email: 'a@b.com' }, 'gym-a'),
    /Academia nao encontrada/,
  );
});

test('invalid or already-used onboarding token is rejected', async () => {
  const prisma = {
    session: { findFirst: async () => null },
  };
  const service = new StudentsService(prisma, auditMock(), entitlementsMock());

  await assert.rejects(
    () => service.acceptInvite({ token: 'x'.repeat(43), password: 'SenhaNova123!' }),
    /Convite invalido ou expirado/,
  );
});


test('trial student cap blocks the 16th non-canceled student', async () => {
  let transactionCalls = 0;
  const prisma = {
    gym: { findFirst: async () => ({ id: 'gym-a', active: true }) },
    student: { findFirst: async () => null },
    user: { findUnique: async () => null },
    role: { findUnique: async () => studentRole() },
    commercialTrialProvisioning: {
      findFirst: async () => ({
        subscriptionId: 'subscription-trial',
      }),
    },
    tenantProductSubscription: {
      findFirst: async () => ({ id: 'subscription-trial' }),
    },
    $transaction: async (callback, options) => {
      transactionCalls += 1;
      assert.equal(options.isolationLevel, 'Serializable');
      return callback({
        student: {
          count: async () => 15,
        },
      });
    },
  };

  const service = new StudentsService(prisma, auditMock(), entitlementsMock(15));
  await assert.rejects(
    () =>
      service.create(
        { name: 'Aluno 16', email: 'aluno16@example.com' },
        'gym-a',
        'owner-a',
      ),
    /Trial limitado a 15 alunos/,
  );
  assert.equal(transactionCalls, 1);
});

test('paid/non-trial tenant does not receive the trial-only student cap', async () => {
  const existingUser = {
    id: 'user-paid',
    email: 'paid@example.com',
    name: 'Paid Student',
    phone: null,
    active: true,
  };
  const tx = {
    userRole: {
      findFirst: async () => ({ id: 'existing-role' }),
      create: async () => {
        throw new Error('MUST_NOT_CREATE_ROLE');
      },
    },
    student: {
      create: async ({ data }) => ({
        id: 'student-paid',
        ...data,
        status: 'ACTIVE',
        enrollmentDate: new Date('2026-09-28T00:00:00Z'),
        user: existingUser,
      }),
    },
    session: {
      updateMany: async () => ({ count: 0 }),
      create: async () => {
        throw new Error('MUST_NOT_CREATE_SESSION');
      },
    },
  };
  const prisma = {
    gym: { findFirst: async () => ({ id: 'gym-a', active: true }) },
    student: { findFirst: async () => null },
    user: { findUnique: async () => existingUser },
    role: { findUnique: async () => studentRole() },
    commercialTrialProvisioning: { findFirst: async () => null },
    $transaction: async (callback, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return callback(tx);
    },
  };

  const service = new StudentsService(prisma, auditMock(), entitlementsMock(15));
  const result = await service.create(
    { name: existingUser.name, email: existingUser.email },
    'gym-a',
    'owner-a',
  );
  assert.equal(result.id, 'student-paid');
});


test('student invite is atomically claimed before activation; replay cannot overwrite password', async () => {
  let claimCount = 0;
  let passwordUpdates = 0;
  const invite = { id: 'inv-a', userId: 'student-a', refreshTokenHash: 'opaque' };
  const prisma = {
    session: { findFirst: async () => invite },
    $transaction: async (fn) => fn({
      session: { updateMany: async ({ where }) => {
        assert.equal(where.id, invite.id);
        assert.equal(where.userId, invite.userId);
        assert.equal(where.revokedAt, null);
        claimCount += 1;
        return { count: claimCount === 1 ? 1 : 0 };
      } },
      user: { update: async () => { passwordUpdates += 1; } },
    }),
  };
  const service = new StudentsService(prisma, auditMock(), entitlementsMock());
  const body = { token: 'a'.repeat(43), password: 'SenhaNova123!' };
  assert.deepEqual(await service.acceptInvite(body), { activated: true, userId: 'student-a' });
  await assert.rejects(() => service.acceptInvite(body), /Convite invalido ou expirado/);
  assert.equal(claimCount, 2);
  assert.equal(passwordUpdates, 1);
});
