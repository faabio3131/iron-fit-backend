import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  AiMobileAdvisoryService,
} = require('../dist/src/modules/ai/ai-mobile-advisory.service.js');

function buildService({ providerOutput, eligibleExercises } = {}) {
  const calls = {
    policy: [],
    context: [],
    execute: [],
    resolve: [],
  };

  const recommendationOutput =
    providerOutput ?? {
      recommendations: [
        {
          exerciseId: 'exercise-a',
          reason: 'Conteúdo útil para revisar a execução técnica.',
        },
      ],
    };

  const candidates =
    eligibleExercises ?? [
      {
        exerciseId: 'exercise-a',
        name: 'Agachamento',
        muscleGroup: 'Pernas',
        movement: 'Agachar',
        level: 'Intermediário',
        contentKind: 'EXTERNAL_REFERENCE',
        policyMode: 'YOUTUBE_EXTERNAL',
      },
    ];

  const service = new AiMobileAdvisoryService(
    {
      assertAllowed: async (value) => {
        calls.policy.push(value);
        return { allowed: true };
      },
    },
    {
      buildStudentContentRecommendationContext: async (value) => {
        calls.context.push(value);
        return {
          modelContext: {
            purpose: value.purpose,
            eligibleExercises: candidates.map((item) => ({
              exerciseId: item.exerciseId,
              name: item.name,
            })),
          },
          eligibleExercises: candidates,
        };
      },
      resolveEligibleExerciseContent: async (
        gymId,
        exerciseId,
        userId,
        isStudent,
      ) => {
        calls.resolve.push({ gymId, exerciseId, userId, isStudent });
        return {
          kind: 'EXTERNAL_REFERENCE',
          exerciseId,
          policyMode: 'YOUTUBE_EXTERNAL',
          source: 'Exercise.videoUrl',
          url: 'https://www.youtube.com/watch?v=canonical',
        };
      },
    },
    {
      sanitize: (value) => value,
    },
    {
      execute: async (request) => {
        calls.execute.push(request);
        return {
          status: 'SUCCEEDED',
          output: recommendationOutput,
          flags: [],
        };
      },
    },
    {
      validateAdvisoryOutput: async (_gymId, _userId, output) => ({
        valid: true,
        output,
        flags: [],
      }),
    },
  );

  return { service, calls };
}

test('AI-GAP-1 executes CONTENT_RECOMMENDATION with authenticated tenant and canonical candidates', async () => {
  const { service, calls } = buildService();

  const result = await service.contentRecommendations(
    { id: 'user-a', activeGymId: 'gym-a' },
    { limit: 3 },
  );

  assert.equal(calls.policy.length, 1);
  assert.deepEqual(calls.policy[0], {
    gymId: 'gym-a',
    userId: 'user-a',
    capability: 'CONTENT_RECOMMENDATION',
    purpose: 'content_recommendation',
    isStudent: true,
  });
  assert.equal(calls.context.length, 1);
  assert.equal(calls.execute.length, 1);
  assert.equal(calls.execute[0].capability, 'CONTENT_RECOMMENDATION');
  assert.equal(
    calls.execute[0].prompt.promptKey,
    'student.content_recommendation',
  );
  assert.equal(calls.execute[0].context.tenantId, 'gym-a');
  assert.equal(calls.resolve.length, 1);
  assert.equal(calls.resolve[0].exerciseId, 'exercise-a');
  assert.equal(result.advisory, true);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].exerciseName, 'Agachamento');
  assert.equal(
    result.recommendations[0].content.url,
    'https://www.youtube.com/watch?v=canonical',
  );
});

test('AI-GAP-1 rejects provider exercise identifiers outside the canonical candidate set', async () => {
  const { service, calls } = buildService({
    providerOutput: {
      recommendations: [
        {
          exerciseId: 'exercise-forged',
          reason: 'Tentativa fora do contexto.',
        },
      ],
    },
  });

  await assert.rejects(
    () =>
      service.contentRecommendations(
        { id: 'user-a', activeGymId: 'gym-a' },
        { limit: 3 },
      ),
    /fora do contexto canonico/,
  );
  assert.equal(calls.resolve.length, 0);
});

test('AI-GAP-1 skips provider execution when canonical content resolver has no eligible content', async () => {
  const { service, calls } = buildService({ eligibleExercises: [] });

  const result = await service.contentRecommendations(
    { id: 'user-a', activeGymId: 'gym-a' },
    {},
  );

  assert.deepEqual(result, {
    recommendations: [],
    advisory: true,
    reason: 'NO_ELIGIBLE_CONTENT',
  });
  assert.equal(calls.execute.length, 0);
  assert.equal(calls.resolve.length, 0);
});
