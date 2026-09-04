import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PortalService } = require('../dist/src/modules/portal/portal.service.js');

test('student id-based workout routes no longer grant STUDENT role', async () => {
  const source = await readFile('src/modules/workouts/workouts.controller.ts', 'utf8');
  assert.equal(source.includes("@Roles('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER', 'STUDENT')"), false);
});

test('/me portal is explicitly restricted to STUDENT role', async () => {
  const source = await readFile('src/modules/portal/portal.controller.ts', 'utf8');
  assert.equal(source.includes("@Roles('STUDENT')"), true);
  assert.equal(source.includes('RolesGuard'), true);
});

test('portal profile resolves the authenticated student inside the active gym', async () => {
  const calls = [];
  const prisma = {
    student: {
      findFirst: async (args) => {
        calls.push(args);
        return {
          id: 'student-a',
          userId: 'user-a',
          gymId: 'gym-a',
          status: 'ACTIVE',
          enrollmentDate: new Date(),
          goal: null,
          level: null,
          gym: { id: 'gym-a', name: 'Gym A', slug: 'gym-a', logoUrl: null },
          user: { name: 'Aluno A', email: 'a@example.com', phone: null },
        };
      },
    },
  };

  const service = new PortalService(prisma);
  const profile = await service.getProfile('user-a', 'gym-a');

  assert.equal(profile.id, 'student-a');
  assert.deepEqual(calls[0].where, { userId: 'user-a', gymId: 'gym-a' });
});

test('portal refuses to resolve a student without active tenant context', async () => {
  let dbCalled = false;
  const prisma = {
    student: {
      findFirst: async () => {
        dbCalled = true;
        return null;
      },
    },
  };

  const service = new PortalService(prisma);

  await assert.rejects(
    () => service.getProfile('user-a', null),
    /Perfil de aluno nao encontrado/,
  );
  assert.equal(dbCalled, false);
});

test('portal workouts are constrained by authenticated user, student and gym', async () => {
  const workoutCalls = [];
  const prisma = {
    student: {
      findFirst: async () => ({
        id: 'student-a',
        userId: 'user-a',
        gymId: 'gym-a',
        gym: { id: 'gym-a' },
        user: { id: 'user-a' },
      }),
    },
    workout: {
      findMany: async (args) => {
        workoutCalls.push(args);
        return [];
      },
    },
  };

  const service = new PortalService(prisma);
  await service.getWorkouts('user-a', 'gym-a');

  assert.equal(workoutCalls.length, 1);
  assert.deepEqual(workoutCalls[0].where.studentId, 'student-a');
  assert.deepEqual(workoutCalls[0].where.student, {
    gymId: 'gym-a',
    userId: 'user-a',
  });
});

test('portal schedules also require the slot to belong to the active gym', async () => {
  const scheduleCalls = [];
  const prisma = {
    student: {
      findFirst: async () => ({
        id: 'student-a',
        userId: 'user-a',
        gymId: 'gym-a',
        gym: { id: 'gym-a' },
        user: { id: 'user-a' },
      }),
    },
    studentSchedule: {
      findMany: async (args) => {
        scheduleCalls.push(args);
        return [];
      },
    },
  };

  const service = new PortalService(prisma);
  await service.getSchedules('user-a', 'gym-a');

  assert.deepEqual(scheduleCalls[0].where.slot, { gymId: 'gym-a' });
  assert.deepEqual(scheduleCalls[0].where.student, {
    gymId: 'gym-a',
    userId: 'user-a',
  });
});
