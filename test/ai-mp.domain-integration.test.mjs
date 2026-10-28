import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AiMobileAdvisoryService } = require('../dist/src/modules/ai/ai-mobile-advisory.service.js');
const { AiWorkoutCandidateService } = require('../dist/src/modules/ai/ai-workout-candidate.service.js');
const { AiOutputValidatorService } = require('../dist/src/modules/ai/validation/ai-output-validator.service.js');
const { AiProviderExecutionService } = require('../dist/src/modules/ai/runtime/ai-provider-execution.service.js');
const { AiProviderRegistryService } = require('../dist/src/modules/ai/providers/ai-provider-registry.service.js');
const { NullAiProviderAdapter } = require('../dist/src/modules/ai/providers/null-ai-provider.adapter.js');
const { OpenAiCompatibleProviderAdapter, GeminiNativeProviderAdapter } = require('../dist/src/modules/ai/providers/external-ai-provider.adapters.js');
const { AiPolicyGuardService } = require('../dist/src/modules/ai/policy/ai-policy-guard.service.js');
const { AiSanitizerService } = require('../dist/src/modules/ai/security/ai-sanitizer.service.js');
const { IntegrationSecretValue } = require('../dist/src/modules/integrations/secrets/integration-secret-vault.port.js');
const exerciseId = 'e9ce9011-b8d3-4bde-a926-3c030e2500b7';

for (const Adapter of [OpenAiCompatibleProviderAdapter, GeminiNativeProviderAdapter]) {
  test('AI-MP four canonical domains use ' + Adapter.name + ' and preserve human review', async () => {
    const events = { requests: [], attempts: [], traces: [], workouts: [] };
    const adapter = new Adapter({ post: async (_url, _headers, body) => {
      const payload = JSON.parse(body);
      const modelInput = JSON.parse(payload.messages?.[1].content ?? payload.contents[0].parts[0].text);
      events.requests.push(modelInput);
      const outputs = {
        ADVISORY_CHAT: { message: 'Orientação com revisão profissional.' },
        WORKOUT_INSIGHTS: { summary: 'Evolução gradual.', recommendations: [], projection: { label: 'Evolução', value: 'Gradual', detail: 'Sem promessa de resultado.' } },
        CONTENT_RECOMMENDATION: { recommendations: [{ exerciseId, reason: 'Compatível com o contexto.' }] },
        WORKOUT_GENERATION: { sessions: [{ name: 'Treino A', exercises: [{ exerciseId, sets: 3, reps: '12' }] }] },
      };
      const text = JSON.stringify(outputs[modelInput.capability]);
      return { status: 200, body: JSON.stringify(Adapter === OpenAiCompatibleProviderAdapter ? { choices: [{ message: { content: text } }] } : { candidates: [{ content: { parts: [{ text }] } }] }) };
    } });
    const registry = new AiProviderRegistryService(new NullAiProviderAdapter()); registry.register(adapter);
    const configurations = { resolve: async (_tenant, capability) => ({ available: true, profileId: 'profile', flags: [], configuration: {
      scope: 'GLOBAL', capability, providerCode: adapter.providerCode, modelCode: 'configured', timeoutMs: 1000, budgetUnits: 20, enabled: true, status: 'ACTIVE', version: 1, fallbackBehavior: 'FAIL_CLOSED',
    } }) };
    const execution = new AiProviderExecutionService(configurations, registry,
      { resolveForExecution: async () => ({ available: true, connectionId: 'central', credential: new IntegrationSecretValue('synthetic-private-key') }) },
      { reserve: async () => 'attempt-' + events.attempts.length, complete: async (_id, result) => events.attempts.push(result) });
    const policy = new AiPolicyGuardService({ resolveFeatureForUser: async () => ({ value: true }), resolveFeature: async () => ({ value: true }) });
    const context = {
      buildStudentAdvisoryContext: async () => ({ trainingSummary: 'synthetic' }),
      buildStudentContentRecommendationContext: async () => ({ eligibleExercises: [{ exerciseId, name: 'Exercício' }], modelContext: { eligibleExercises: [{ exerciseId }] } }),
      resolveEligibleExerciseContent: async () => ({ kind: 'MANAGED_CONTENT', contentId: 'canonical' }),
      buildWorkoutGenerationContext: async () => ({ exercises: [{ exerciseId }] }),
    };
    const validator = new AiOutputValidatorService({}, {});
    const sanitizer = new AiSanitizerService();
    const mobile = new AiMobileAdvisoryService(policy, context, sanitizer, execution, validator);
    const user = { id: 'student', activeGymId: 'tenant' };
    assert.match((await mobile.chat(user, { message: 'Como evoluir?' })).message, /profissional/);
    assert.equal((await mobile.workoutInsights(user, {})).summary, 'Evolução gradual.');
    const content = await mobile.contentRecommendations(user, { exerciseIds: [exerciseId], limit: 1 });
    assert.equal(content.recommendations[0].content.contentId, 'canonical');
    const workouts = new AiWorkoutCandidateService(
      { auditLog: { create: async () => ({}) } }, policy, context, sanitizer, execution, configurations,
      { recordExecution: async trace => { events.traces.push(trace); return { id: 'trace' }; } }, validator,
      { createAiCandidate: async dto => { events.workouts.push(dto); return { id: 'workout', status: 'PENDING_REVIEW' }; } });
    const workout = await workouts.generate({ id: 'trainer' }, 'tenant', { studentId: 'student' });
    assert.equal(workout.requiresHumanReview, true);
    assert.equal(workout.workout.status, 'PENDING_REVIEW');
    assert.equal(events.traces[0].providerCode, adapter.providerCode);
    assert.deepEqual(events.requests.map(x => x.capability), ['ADVISORY_CHAT', 'WORKOUT_INSIGHTS', 'CONTENT_RECOMMENDATION', 'WORKOUT_GENERATION']);
    assert.equal(events.attempts.length, 4);
    assert.equal(JSON.stringify(events.traces).includes('synthetic-private-key'), false);
  });
}

test('AI-MP model authority injection cannot pass the canonical output validator', async () => {
  const validator = new AiOutputValidatorService({}, {});
  for (const output of [{ approved: true }, { nested: { publish: true } }, { message: 'https://untrusted.invalid' }, { entitlement: 'active' }]) {
    assert.equal((await validator.validateAdvisoryOutput('tenant', 'user', output)).valid, false);
  }
});
