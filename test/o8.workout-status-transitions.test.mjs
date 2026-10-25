import test from 'node:test';
import assert from 'node:assert/strict';

const { WorkoutsService } = await import('../dist/src/modules/workouts/workouts.service.js');

function prismaWithWorkout(status, { approver, gymId = 'gym-1', conflict = false } = {}) {
  const updates = [], audits = [];
  let currentStatus = status;
  let approvedById = approver === undefined ? (status === 'APPROVED' || status === 'ACTIVE' ? 'reviewer-1' : null) : approver;
  const fixture = {
    updates, audits,
    prisma: {
      workout: {
        findUnique: async () => ({
          id: 'workout-1', status: currentStatus, approvedById, student: { gymId },
        }),
        update: async ({ where, data }) => {
          updates.push({ where, data });
          if (conflict || where.id !== 'workout-1' || where.status !== currentStatus) {
            throw Object.assign(new Error('Stale workout status'), { code: 'P2025' });
          }
          currentStatus = data.status;
          if (data.approvedById !== undefined) approvedById = data.approvedById;
          return { id: 'workout-1', status: currentStatus, approvedById };
        },
      },
      auditLog: { create: async ({ data }) => { audits.push(data); return { id: 'audit-1', ...data }; } },
    },
  };
  fixture.prisma.$transaction = async (operation, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    return operation(fixture.prisma);
  };
  return fixture;
}

test('O8 blocks direct activation of an AI candidate or draft', async () => {
  for (const initial of ['PENDING_REVIEW', 'DRAFT']) {
    const fixture = prismaWithWorkout(initial);
    await assert.rejects(
      () => new WorkoutsService(fixture.prisma).updateStatus('workout-1', 'ACTIVE', 'reviewer-1', 'gym-1'),
      new RegExp('Transicao de treino invalida: ' + initial + ' -> ACTIVE'),
    );
    assert.equal(fixture.updates.length, 0);
    assert.equal(fixture.audits.length, 0);
  }
});

test('O8 records human approval and does not change original reviewer on activation', async () => {
  const fixture = prismaWithWorkout('DRAFT');
  const service = new WorkoutsService(fixture.prisma);
  const approved = await service.updateStatus('workout-1', 'APPROVED', 'reviewer-1', 'gym-1');
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.approvedById, 'reviewer-1');
  assert.deepEqual(fixture.updates[0].where, { id: 'workout-1', status: 'DRAFT' });
  assert.equal(fixture.updates[0].data.approvedById, 'reviewer-1');
  const active = await service.updateStatus('workout-1', 'ACTIVE', 'reviewer-2', 'gym-1');
  assert.equal(active.status, 'ACTIVE');
  assert.equal(active.approvedById, 'reviewer-1');
  assert.deepEqual(fixture.updates[1].where, { id: 'workout-1', status: 'APPROVED' });
  assert.equal(Object.hasOwn(fixture.updates[1].data, 'approvedById'), false);
  assert.equal(fixture.audits.length, 2);
  assert.equal(fixture.audits[1].next.approvedById, 'reviewer-1');
});

test('O8 rejects stale updates under concurrency without false audit', async () => {
  const fixture = prismaWithWorkout('APPROVED', { conflict: true });
  await assert.rejects(
    () => new WorkoutsService(fixture.prisma).updateStatus('workout-1', 'ACTIVE', 'reviewer-2', 'gym-1'),
    /Treino foi alterado por outra operacao/,
  );
  assert.deepEqual(fixture.updates[0].where, { id: 'workout-1', status: 'APPROVED' });
  assert.equal(fixture.audits.length, 0);
});

test('O8 fails closed when approved workout has no reviewer', async () => {
  const fixture = prismaWithWorkout('APPROVED', { approver: null });
  await assert.rejects(
    () => new WorkoutsService(fixture.prisma).updateStatus('workout-1', 'ACTIVE', 'reviewer-2', 'gym-1'),
    /Treino sem revisor humano registrado/,
  );
  assert.equal(fixture.updates.length, 0);
});

test('O8 enforces tenant and prevents reopening expired workout', async () => {
  const foreign = prismaWithWorkout('APPROVED', { gymId: 'other-gym' });
  await assert.rejects(
    () => new WorkoutsService(foreign.prisma).updateStatus('workout-1', 'ACTIVE', 'reviewer-2', 'gym-1'),
    /Treino nao encontrado/,
  );
  assert.equal(foreign.updates.length, 0);
  const expired = prismaWithWorkout('EXPIRED');
  await assert.rejects(
    () => new WorkoutsService(expired.prisma).updateStatus('workout-1', 'APPROVED', 'reviewer-2', 'gym-1'),
    /Transicao de treino invalida: EXPIRED -> APPROVED/,
  );
  assert.equal(expired.updates.length, 0);
});
