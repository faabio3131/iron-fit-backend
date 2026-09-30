import test from 'node:test';
import assert from 'node:assert/strict';

const { WorkoutsService } = await import('../dist/src/modules/workouts/workouts.service.js');

function prismaWithWorkout(status) {
  const updates = [];
  return {
    updates,
    prisma: {
      workout: {
        findUnique: async () => ({
          id: 'workout-1',
          status,
          approvedById: status === 'APPROVED' || status === 'ACTIVE' ? 'reviewer-1' : null,
          student: { gymId: 'gym-1' },
        }),
        update: async ({ data }) => {
          updates.push(data);
          return { id: 'workout-1', ...data };
        },
      },
      auditLog: {
        create: async ({ data }) => ({ id: 'audit-1', ...data }),
      },
    },
  };
}

test('O8 blocks direct activation of an AI candidate before human approval', async () => {
  const fixture = prismaWithWorkout('PENDING_REVIEW');
  const service = new WorkoutsService(fixture.prisma);

  await assert.rejects(
    () => service.updateStatus('workout-1', 'ACTIVE', 'reviewer-1', 'gym-1'),
    /Transicao de treino invalida: PENDING_REVIEW -> ACTIVE/,
  );
  assert.equal(fixture.updates.length, 0);
});

test('O8 requires approval before activation and records the human approver', async () => {
  const draft = prismaWithWorkout('DRAFT');
  const draftService = new WorkoutsService(draft.prisma);
  const approved = await draftService.updateStatus('workout-1', 'APPROVED', 'reviewer-1', 'gym-1');
  assert.equal(approved.status, 'APPROVED');
  assert.equal(draft.updates[0].approvedById, 'reviewer-1');

  const ready = prismaWithWorkout('APPROVED');
  const readyService = new WorkoutsService(ready.prisma);
  const active = await readyService.updateStatus('workout-1', 'ACTIVE', 'reviewer-2', 'gym-1');
  assert.equal(active.status, 'ACTIVE');
  assert.equal(ready.updates[0].approvedById, 'reviewer-2');
});
