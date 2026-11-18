import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PortalService } = require('../dist/src/modules/portal/portal.service.js');

const requestId = 'guided_20261118_abcdefghijklmnop';
function harness({ studentStatus = 'ACTIVE', workoutActive = true, sets = [2, 3], auditFails = false } = {}) {
  const rows = [];
  const audits = [];
  const calls = { students: [], workout: [], history: [] };
  const student = {
    id: 'student-a', gymId: 'gym-a', userId: 'user-a', status: studentStatus,
    gym: { id: 'gym-a' }, user: { id: 'user-a' },
  };
  const db = {
    student: { findFirst: async (args) => {
      calls.students.push(args);
      if (args.where?.id) return studentStatus === 'ACTIVE' &&
        args.where.gymId === 'gym-a' && args.where.userId === 'user-a' ? { id: student.id } : null;
      return args.where?.userId === 'user-a' && args.where.gymId === 'gym-a' ? student : null;
    } },
    workout: { findFirst: async (args) => {
      calls.workout.push(args);
      if (!workoutActive || args.where.id !== 'workout-a' || args.where.student.gymId !== 'gym-a') return null;
      return { goal: 'Força', sessions: [{ id: 'session-a', name: 'Treino A',
        exercises: sets.map((value) => ({ sets: value })) }] };
    } },
    workoutExecution: {
      findUnique: async ({ where }) => rows.find(row =>
        row.studentId === where.studentId_requestId.studentId &&
        row.requestId === where.studentId_requestId.requestId) ?? null,
      findMany: async (args) => {
        calls.history.push(args);
        return rows.filter(row => row.gymId === args.where.gymId &&
          row.studentId === args.where.studentId);
      },
      create: async ({ data }) => {
        const saved = { ...data, id: 'completed-' + (rows.length + 1), source: 'STUDENT_SELF_REPORTED',
          completedAt: new Date('2026-11-18T15:00:00Z') };
        rows.push(saved);
        return saved;
      },
    },
    auditLog: { create: async (args) => {
      if (auditFails) throw new Error('audit failed');
      audits.push(args.data);
    } },
  };
  // Simulate transactional rollback on an audit error.
  const prisma = {
    ...db,
    $transaction: async (operation) => {
      const initial = rows.length;
      try { return await operation(db); } catch (error) { rows.length = initial; throw error; }
    },
  };
  return { service: new PortalService(prisma, { record: (input, tx) => tx.auditLog.create({ data: input }) }),
    rows, audits, calls };
}

test('P1 student completion is academy-scoped, server-prescribed, audited and idempotent', async () => {
  const { service, rows, audits, calls } = harness();
  const first = await service.completeWorkoutSession('user-a', 'gym-a', 'workout-a', 'session-a', requestId);
  assert.equal(first.completedSets, 5);
  assert.equal(first.source, 'STUDENT_SELF_REPORTED');
  assert.equal(first.replayed, false);
  assert.equal(rows.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'STUDENT_WORKOUT_SESSION_SELF_REPORTED');
  assert.deepEqual(calls.workout[0].where.student, { gymId: 'gym-a', userId: 'user-a' });
  assert.equal(calls.workout[0].where.status, 'ACTIVE');
  const replay = await service.completeWorkoutSession('user-a', 'gym-a', 'workout-a', 'session-a', requestId);
  assert.equal(replay.replayed, true);
  assert.equal(replay.id, first.id);
  assert.equal(rows.length, 1);
  assert.equal(audits.length, 1);
  await assert.rejects(() => service.completeWorkoutSession('user-a', 'gym-a', 'workout-b', 'session-a', requestId),
    /Identificador ja utilizado/);
});

test('P1 student completion rejects cross-gym, inactive, unapproved, invalid or malformed requests', async () => {
  const ok = harness();
  await assert.rejects(() => ok.service.completeWorkoutSession('user-a', 'gym-b', 'workout-a', 'session-a', requestId),
    /Perfil de aluno/);
  await assert.rejects(() => ok.service.completeWorkoutSession('user-a', 'gym-a', 'workout-a', 'session-a', 'short'),
    /Identificador de execucao invalido/);
  const inactive = harness({ studentStatus: 'SUSPENDED' });
  await assert.rejects(() => inactive.service.completeWorkoutSession('user-a', 'gym-a', 'workout-a', 'session-a', requestId),
    /Matricula inativa/);
  const unavailable = harness({ workoutActive: false });
  await assert.rejects(() => unavailable.service.completeWorkoutSession('user-a', 'gym-a', 'workout-a', 'session-a', requestId),
    /Sessao ativa/);
  const partial = harness({ sets: [3, null] });
  await assert.rejects(() => partial.service.completeWorkoutSession('user-a', 'gym-a', 'workout-a', 'session-a', requestId),
    /Prescricao incompleta/);
  for (const ctx of [ok, inactive, unavailable, partial]) assert.equal(ctx.rows.length, 0);
});

test('P1 completion cannot persist if audit fails; history read is gym and student scoped', async () => {
  const broken = harness({ auditFails: true });
  await assert.rejects(() => broken.service.completeWorkoutSession('user-a', 'gym-a', 'workout-a', 'session-a', requestId),
    /audit failed/);
  assert.equal(broken.rows.length, 0);
  const healthy = harness();
  await healthy.service.completeWorkoutSession('user-a', 'gym-a', 'workout-a', 'session-a', requestId);
  const rows = await healthy.service.getWorkoutExecutions('user-a', 'gym-a');
  assert.equal(rows.length, 1);
  assert.deepEqual(healthy.calls.history[0].where, { studentId: 'student-a', gymId: 'gym-a' });
  assert.equal(healthy.calls.history[0].take, 30);
  await assert.rejects(() => healthy.service.getWorkoutExecutions('user-a', 'gym-b'), /Perfil de aluno/);
});

test('P1 HTTP endpoint is protected by canonical STUDENT auth and does not accept mutable set counts', async () => {
  const controller = await readFile('src/modules/portal/portal.controller.ts', 'utf8');
  const dto = await readFile('src/modules/portal/dto/complete-workout-session.dto.ts', 'utf8');
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  assert.match(controller, /@UseGuards\(JwtAuthGuard, RolesGuard\)/);
  assert.match(controller, /@Roles\('STUDENT'\)/);
  assert.match(controller, /@Post\('workouts\/:workoutId\/sessions\/:sessionId\/completions'\)/);
  assert.match(dto, /requestId!/);
  assert.doesNotMatch(dto, /completedSets|gymId|studentId/);
  assert.match(schema, /@@unique\(\[studentId, requestId\]\)/);
});
