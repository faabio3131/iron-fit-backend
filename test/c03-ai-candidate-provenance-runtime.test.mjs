import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AiWorkoutCandidateService } = require('../dist/src/modules/ai/ai-workout-candidate.service.js');

const identity = { id: 'professional-1', activeGymId: 'gym-1' };
const request = { studentId: 'student-1', requestId: 'req-c03-1', instructions: 'Treino de resistencia' };
const exerciseId = 'e9ce9011-b8d3-4bde-a926-3c030e2500b7';

function harness(output) {
  const events = { traces: [], workouts: [], audits: [], providerCalls: 0 };
  const service = new AiWorkoutCandidateService(
    { auditLog: { create: async ({ data }) => { events.audits.push(data); } } },
    { assertAllowed: async () => undefined },
    { buildWorkoutGenerationContext: async () => ({ studentId: request.studentId }) },
    { sanitize: (value) => value },
    { execute: async () => {
      events.providerCalls++;
      return { status: 'SUCCEEDED', output, flags: [], confidence: 0.95 };
    } },
    { resolve: async () => ({
      available: true,
      profileId: 'profile-1',
      configuration: {
        providerCode: 'NULL_TEST',
        modelCode: 'mock-1',
        scope: 'GLOBAL',
        version: 1,
      },
      flags: [],
    }) },
    { recordExecution: async (data) => {
      events.traces.push(data);
      return { id: 'trace-1' };
    } },
    { validateAdvisoryOutput: async (_gymId, _userId, response) => ({
      valid: true,
      output: response,
      flags: [],
    }) },
    { createAiCandidate: async (dto) => {
      events.workouts.push(dto);
      return { id: 'workout-1', status: 'PENDING_REVIEW', createdByAI: true };
    } },
  );
  return { service, events };
}

test('C03: provider response with no sessions is REJECTED before any successful trace or domain mutation', async () => {
  const { service, events } = harness({ sessions: [] });
  await assert.rejects(
    service.generate(identity, 'gym-1', request),
    (error) => error?.getStatus?.() === 502
      && error?.getResponse?.().code === 'AI_WORKOUT_GENERATION_INVALID_RESPONSE',
  );
  assert.equal(events.providerCalls, 1);
  assert.deepEqual(events.traces.map((trace) => trace.status), ['REJECTED']);
  assert.equal(events.traces[0].failureCategory, 'INVALID_RESPONSE');
  assert.equal(events.traces[0].requestId, request.requestId);
  assert.equal(typeof events.traces[0].outputHash, 'string');
  assert.equal(events.traces[0].output, undefined);
  assert.equal(events.workouts.length, 0);
  assert.equal(events.audits.length, 0);
});

test('C03: forged or noncanonical exercise identifiers cannot produce a successful execution trace', async () => {
  const { service, events } = harness({
    sessions: [{ name: 'Treino', exercises: [{ exerciseId: 'not-an-uuid' }] }],
  });
  await assert.rejects(service.generate(identity, 'gym-1', request), /AI_WORKOUT_GENERATION_INVALID_RESPONSE|Bad Gateway/i);
  assert.deepEqual(events.traces.map((trace) => trace.status), ['REJECTED']);
  assert.equal(events.workouts.length, 0);
});

test('C03: valid candidate is normalized before SUCCESS and remains pending human review', async () => {
  const { service, events } = harness({
    sessions: [{ name: 'Treino A', exercises: [{ exerciseId, sets: 3, reps: '12' }] }],
  });
  const result = await service.generate(identity, 'gym-1', request);
  assert.deepEqual(events.traces.map((trace) => trace.status), ['SUCCEEDED']);
  assert.equal(events.workouts.length, 1);
  assert.equal(events.workouts[0].studentId, request.studentId);
  assert.equal(events.workouts[0].sessions[0].exercises[0].exerciseId, exerciseId);
  assert.equal(result.workout.status, 'PENDING_REVIEW');
  assert.equal(result.requiresHumanReview, true);
  assert.equal(events.audits[0].next.aiExecutionTraceId, 'trace-1');
});
