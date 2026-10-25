import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Prisma } = require('@prisma/client');
const { validateSync } = require('class-validator');
const { ExercisesService } = require('../dist/src/modules/exercises/exercises.service.js');
const { AssessmentsService } = require('../dist/src/modules/assessments/assessments.service.js');
const { CreateAssessmentDto } = require('../dist/src/modules/assessments/dto/create-assessment.dto.js');
const { WorkoutsService } = require('../dist/src/modules/workouts/workouts.service.js');

test('C02 concurrent exercise catalog insert collision returns conflict, not HTTP 500', async () => {
  let attempted = 0;
  const service = new ExercisesService({
    exercise: {
      findUnique: async () => null,
      create: async () => {
        attempted++;
        throw new Prisma.PrismaClientKnownRequestError('Unique violation', {
          code: 'P2002', clientVersion: '6.19.3',
        });
      },
    },
  });
  await assert.rejects(
    () => service.create({ name: 'Agachamento', muscleGroup: 'Pernas' }),
    error => error?.getStatus?.() === 409,
  );
  assert.equal(attempted, 1);
});

test('C02 assessment DTO rejects zero/negative measurements and invalid body fat', () => {
  for (const invalid of [
    { weight: 0 }, { weight: -1 }, { height: 0 },
    { bmi: 0 }, { bodyFatPercent: -1 }, { bodyFatPercent: 101 },
  ]) {
    const dto = Object.assign(new CreateAssessmentDto(), invalid);
    const errors = validateSync(dto);
    assert.ok(errors.length > 0, 'Accepted invalid assessment: ' + JSON.stringify(invalid));
  }
  const valid = Object.assign(new CreateAssessmentDto(), {
    weight: 79.5, height: 180, bodyFatPercent: 0,
  });
  assert.deepEqual(validateSync(valid), []);
});

test('C02 invalid clinical assessment data is rejected at service boundary too', async () => {
  let created = 0;
  const service = new AssessmentsService({
    student: { findFirst: async () => ({ id: 'student-a', user: { name: 'Ana' } }) },
    assessment: { create: async () => { created++; } },
  });
  await assert.rejects(
    () => service.create({ studentId: 'student-a', weight: 70, height: 0 }, 'trainer-a', 'gym-a'),
    error => error?.getStatus?.() === 400,
  );
  assert.equal(created, 0);
});

test('C02 BMI computation is finite and respects an explicit valid BMI', async () => {
  const inputs = [];
  const prisma = {
    student: { findFirst: async () => ({ id: 'student-a', user: { name: 'Ana' } }) },
    assessment: {
      create: async ({ data }) => {
        inputs.push(data);
        return { ...data, id: 'assessment-a', createdAt: new Date() };
      },
    },
    workout: { count: async () => 0 },
    auditLog: { create: async ({ data }) => ({ id: 'audit-a', ...data }) },
  };
  const service = new AssessmentsService(prisma);
  await service.create({ studentId: 'student-a', weight: 81, height: 180 }, 'trainer-a', 'gym-a');
  assert.equal(inputs[0].bmi, 25);
  await service.create({ studentId: 'student-a', weight: 81, height: 180, bmi: 24.3 }, 'trainer-a', 'gym-a');
  assert.equal(inputs[1].bmi, 24.3);
});

test('C02 human workout approval cannot commit when canonical audit fails', async () => {
  let status = 'DRAFT';
  let attempts = 0;
  const prisma = {
    workout: {
      findUnique: async () => ({
        id: 'workout-a', status, approvedById: null,
        student: { gymId: 'gym-a' },
      }),
    },
    $transaction: async (operation, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      let uncommitted = null;
      const tx = {
        workout: {
          update: async ({ where, data }) => {
            assert.deepEqual(where, { id: 'workout-a', status: 'DRAFT' });
            uncommitted = data;
            attempts++;
            return { id: 'workout-a', status: data.status, approvedById: data.approvedById };
          },
        },
        auditLog: { create: async () => { throw new Error('audit unavailable'); } },
      };
      const result = await operation(tx);
      status = uncommitted.status;
      return result;
    },
  };
  const service = new WorkoutsService(prisma);
  await assert.rejects(
    () => service.updateStatus('workout-a', 'APPROVED', 'trainer-a', 'gym-a'),
    /audit unavailable/,
  );
  assert.equal(attempts, 1);
  assert.equal(status, 'DRAFT');
});
