import test from 'node:test';
import assert from 'node:assert/strict';

const { ExercisesService } = await import('../dist/src/modules/exercises/exercises.service.js');
const { AssessmentsService } = await import('../dist/src/modules/assessments/assessments.service.js');

test('O7 exercise library pushes search and filters into the canonical query', async () => {
  let observed = null;
  const prisma = {
    exercise: {
      findMany: async (args) => {
        observed = args;
        return [];
      },
    },
  };
  const service = new ExercisesService(prisma);
  await service.findAll({
    search: 'agach',
    muscleGroup: 'Pernas',
    movement: 'Agachamento',
    level: 'Intermediário',
  });

  assert.equal(observed.where.muscleGroup.equals, 'Pernas');
  assert.equal(observed.where.movement.equals, 'Agachamento');
  assert.equal(observed.where.level.equals, 'Intermediário');
  assert.equal(observed.where.OR[0].name.contains, 'agach');
  assert.deepEqual(observed.include, {
    _count: { select: { workoutExercises: true } },
  });
});

test('O7 assessment history stays tenant-scoped and reports linked workout count', async () => {
  let assessmentArgs = null;
  const prisma = {
    student: {
      findFirst: async ({ where }) => where.id === 'student-1' && where.gymId === 'gym-1'
        ? { id: 'student-1' }
        : null,
    },
    assessment: {
      findMany: async (args) => {
        assessmentArgs = args;
        return [{
          id: 'assessment-1',
          weight: 80,
          height: 180,
          bmi: 24.7,
          bodyFatPercent: 18,
          measurements: { waist: 88 },
          restrictions: null,
          notes: 'Base',
          createdAt: new Date('2026-09-30T00:00:00Z'),
          _count: { workouts: 2 },
        }];
      },
    },
  };
  const service = new AssessmentsService(prisma);
  const rows = await service.findAllByStudent('student-1', 'gym-1');

  assert.equal(assessmentArgs.where.studentId, 'student-1');
  assert.deepEqual(assessmentArgs.include, {
    _count: { select: { workouts: true } },
  });
  assert.equal(rows[0].workoutCount, 2);
  await assert.rejects(
    () => service.findAllByStudent('student-1', 'gym-2'),
    /Aluno nao encontrado/,
  );
});
