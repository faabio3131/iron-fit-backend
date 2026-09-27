import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DAY, login, plus, request } from '../scripts/b6-e2e-lib.mjs';

const prisma = new PrismaClient();

async function createTenant(label) {
  const suffix = randomUUID().slice(0, 8);
  const password = process.env.B6_OWNER_PASSWORD;
  assert.ok(password);
  const email = `b6-${label}-${suffix}@example.com`;
  const trial = (await request('/commercial/trial/start', {
    method: 'POST',
    expected: 201,
    body: {
      requestId: randomUUID(),
      email,
      password,
      name: `B6 ${label} Owner`,
      gymName: `B6 ${label} ${suffix}`,
      timezone: 'America/Sao_Paulo',
    },
  })).payload;
  return { suffix, email, password, trial, owner: await login(email, password) };
}

test('B6 live operational domain, RBAC, cross-tenant and student/mobile parity', async () => {
  const a = await createTenant('ops-a');
  const b = await createTenant('ops-b');
  const staffPassword = process.env.B6_STAFF_PASSWORD;
  const studentPassword = process.env.B6_STUDENT_PASSWORD;
  assert.ok(staffPassword && studentPassword);

  await request('/users', {
    method: 'POST',
    token: a.owner.access_token,
    expected: 400,
    body: {
      email: `weak-${a.suffix}@example.com`,
      password: 'weakpass',
      name: 'Weak Staff',
      roleName: 'TRAINER',
    },
  });

  const roles = {
    manager: `manager-${a.suffix}@example.com`,
    trainer: `trainer-${a.suffix}@example.com`,
    reception: `reception-${a.suffix}@example.com`,
  };
  for (const [roleName, email] of [
    ['MANAGER', roles.manager],
    ['TRAINER', roles.trainer],
    ['RECEPTION', roles.reception],
  ]) {
    await request('/users', {
      method: 'POST',
      token: a.owner.access_token,
      expected: 201,
      body: {
        email,
        password: staffPassword,
        name: `B6 ${roleName}`,
        roleName,
      },
    });
  }

  const manager = await login(roles.manager, staffPassword);
  const trainer = await login(roles.trainer, staffPassword);
  const reception = await login(roles.reception, staffPassword);
  await request('/users', { token: manager.access_token, expected: 403 });
  await request('/financial/accounts', { token: trainer.access_token, expected: 403 });

  const studentEmail = `student-${a.suffix}@example.com`;
  const created = (await request('/students', {
    method: 'POST',
    token: a.owner.access_token,
    expected: 201,
    body: {
      name: 'B6 Student',
      email: studentEmail,
      goal: 'HIPERTROFIA',
      level: 'INTERMEDIARIO',
      consentHealth: true,
    },
  })).payload;

  await request('/student-onboarding/accept-invite', {
    method: 'POST',
    expected: 400,
    body: { token: created.onboarding.token, password: 'weakpass' },
  });
  await request('/student-onboarding/accept-invite', {
    method: 'POST',
    expected: 201,
    body: { token: created.onboarding.token, password: studentPassword },
  });
  const student = await login(studentEmail, studentPassword);
  await request('/students', { token: student.access_token, expected: 403 });

  await request(`/equipments?gymId=${b.trial.gymId}`, {
    token: a.owner.access_token,
    expected: [400, 403, 404],
  });
  await request(`/students/${created.id}`, {
    token: b.owner.access_token,
    expected: 404,
  });

  const exercise = (await request('/exercises', {
    method: 'POST',
    token: a.owner.access_token,
    expected: 201,
    body: {
      name: `B6 Exercise ${a.suffix}`,
      muscleGroup: 'Peito',
      level: 'INTERMEDIARIO',
    },
  })).payload;
  const catalog = (await request('/equipments/catalog?search=IRON%20B6%20Bench', {
    token: a.owner.access_token,
    expected: 200,
  })).payload;
  const catalogItem = catalog.find((item) => item.slug === 'iron-b6-bench-canonical');
  assert.ok(catalogItem, 'canonical B6 equipment catalog item missing');
  const selectedEquipment = (await request('/equipments/catalog/selection', {
    method: 'POST',
    token: a.owner.access_token,
    expected: 201,
    body: { catalogItemIds: [catalogItem.id] },
  })).payload;
  assert.equal(selectedEquipment.length, 1);
  const equipment = selectedEquipment[0];
  const assessment = (await request(`/students/${created.id}/assessments`, {
    method: 'POST',
    token: trainer.access_token,
    expected: 201,
    body: {
      weight: 72.5,
      height: 1.74,
      bodyFatPercent: 18.2,
      notes: 'B6 assessment',
    },
  })).payload;
  const workout = (await request('/workouts', {
    method: 'POST',
    token: trainer.access_token,
    expected: 201,
    body: {
      studentId: created.id,
      assessmentId: assessment.id,
      goal: 'Hipertrofia',
      level: 'Intermediario',
      weeklyFrequency: 3,
      sessions: [{
        name: 'Treino A',
        order: 1,
        exercises: [{
          exerciseId: exercise.id,
          equipmentId: equipment.id,
          order: 1,
          sets: 4,
          reps: '10',
          restSeconds: 60,
        }],
      }],
    },
  })).payload;
  assert.equal(workout.status, 'DRAFT');
  assert.equal((await request(`/workouts/${workout.id}/status`, {
    method: 'PATCH',
    token: trainer.access_token,
    expected: 200,
    body: { status: 'ACTIVE' },
  })).payload.status, 'ACTIVE');

  await request('/ai/workout-candidates', {
    method: 'POST',
    token: trainer.access_token,
    expected: [502, 503],
    body: {
      studentId: created.id,
      assessmentId: assessment.id,
      requestId: randomUUID(),
      instructions: 'B6 governed candidate',
    },
  });

  const slot = (await request('/schedule-slots', {
    method: 'POST',
    token: a.owner.access_token,
    expected: 201,
    body: {
      weekday: 1,
      startTime: '08:00',
      endTime: '09:00',
      capacity: 10,
      active: true,
    },
  })).payload;
  const booking = (await request('/schedules', {
    method: 'POST',
    token: reception.access_token,
    expected: 201,
    body: {
      studentId: created.id,
      slotId: slot.id,
      date: plus(new Date(), 2 * DAY).toISOString(),
    },
  })).payload;
  await request(`/schedules/${booking.id}/check-in`, {
    method: 'PATCH',
    token: reception.access_token,
    expected: 200,
  });

  const device = await prisma.accessDevice.create({
    data: {
      gymId: a.trial.gymId,
      name: 'B6 Gate',
      type: 'QR_CODE',
      active: true,
    },
  });
  const deviceToken = (await request(`/access/devices/${device.id}/token`, {
    method: 'POST',
    token: a.owner.access_token,
    expected: 201,
  })).payload;
  const credential = (await request('/access/credentials', {
    method: 'POST',
    token: reception.access_token,
    expected: 201,
    body: { studentId: created.id, type: 'QR_CODE' },
  })).payload;
  const nonce = `b6-${randomUUID()}`;
  const scan = {
    qrToken: credential.qrToken,
    deviceId: device.id,
    deviceToken: deviceToken.deviceToken,
    nonce,
    timestamp: Date.now(),
  };
  const allowed = (await request('/access/scan', {
    method: 'POST',
    expected: 201,
    body: scan,
  })).payload;
  assert.equal(allowed.allowed, true);
  const replay = (await request('/access/scan', {
    method: 'POST',
    expected: 201,
    body: { ...scan, timestamp: Date.now() },
  })).payload;
  assert.equal(replay.allowed, false);
  assert.equal(replay.denialReason, 'Replay detectado');

  const account = (await request('/financial/accounts', {
    method: 'POST',
    token: a.owner.access_token,
    expected: 201,
    body: { name: 'B6 Caixa', type: 'CASH', initialBalance: 0 },
  })).payload;
  const plan = (await request('/financial/subscriptions', {
    method: 'POST',
    token: reception.access_token,
    expected: 201,
    body: {
      studentId: created.id,
      planName: 'Mensal B6',
      amount: 14990,
      nextBillingAt: plus(new Date(), 30 * DAY).toISOString(),
    },
  })).payload;
  const charge = (await request('/financial/charges', {
    method: 'POST',
    token: reception.access_token,
    expected: 201,
    body: {
      studentId: created.id,
      subscriptionId: plan.id,
      amount: 14990,
      dueDate: plus(new Date(), 5 * DAY).toISOString(),
      paymentMethod: 'PIX',
    },
  })).payload;
  await request(`/financial/charges/${charge.id}/pay`, {
    method: 'PATCH',
    token: reception.access_token,
    expected: 200,
    body: { accountId: account.id, paymentMethod: 'PIX' },
  });

  assert.equal((await request('/me/profile', {
    token: student.access_token,
    expected: 200,
  })).payload.email, studentEmail);
  assert.ok((await request('/me/workouts', {
    token: student.access_token,
    expected: 200,
  })).payload.some((item) => item.id === workout.id));
  assert.ok((await request('/me/assessments', {
    token: student.access_token,
    expected: 200,
  })).payload.some((item) => item.id === assessment.id));
  assert.ok((await request('/me/schedules', {
    token: student.access_token,
    expected: 200,
  })).payload.some((item) => item.id === booking.id));
  assert.ok((await request('/me/charges', {
    token: student.access_token,
    expected: 200,
  })).payload.some((item) => item.id === charge.id));
}, { timeout: 60000 });

test.after(async () => {
  await prisma.$disconnect();
});
