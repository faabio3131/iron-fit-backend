import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(path, 'utf8');
}

test('AI0 G6 exposes a professional-only governed workout candidate endpoint', async () => {
  const controller = await source('src/modules/ai/ai-workout-candidate.controller.ts');
  assert.match(controller, /@Controller\('ai\/workout-candidates'\)/);
  assert.match(controller, /@Post\(\)/);
  assert.match(controller, /@UseGuards\(JwtAuthGuard, RolesGuard\)/);
  assert.match(controller, /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER'\)/);
  assert.match(controller, /resolveTenantOperationGymId/);
  assert.equal(controller.includes("@Roles('STUDENT')"), false);
});

test('AI0 G6 gates WORKOUT_GENERATION before provider execution', async () => {
  const service = await source('src/modules/ai/ai-workout-candidate.service.ts');
  const policy = service.indexOf('this.policy.assertAllowed');
  const execution = service.indexOf('this.execution.execute');
  assert.ok(policy >= 0 && execution > policy);
  assert.match(service, /capability: 'WORKOUT_GENERATION'/);
  assert.match(service, /purpose = 'workout_candidate_generation'/);
  assert.match(service, /isStudent: false/);
});

test('AI0 G6 rebuilds context server-side and sanitizes provider input', async () => {
  const service = await source('src/modules/ai/ai-workout-candidate.service.ts');
  const context = await source('src/modules/ai/context/ai-context-builder.service.ts');
  assert.match(service, /buildWorkoutGenerationContext/);
  assert.match(service, /this\.sanitizer\.sanitize/);
  assert.match(context, /id: request\.studentId/);
  assert.match(context, /gymId: request\.gymId/);
  assert.match(context, /student\.consentHealth/);
  assert.equal(service.includes('dto.gymId'), false);
});

test('AI0 G6 validates provider output and reuses canonical workout equipment validation', async () => {
  const service = await source('src/modules/ai/ai-workout-candidate.service.ts');
  const workouts = await source('src/modules/workouts/workouts.service.ts');
  assert.match(service, /validateAdvisoryOutput/);
  assert.match(service, /this\.workouts\.createAiCandidate/);
  assert.match(workouts, /findEquipmentExerciseMapping/);
  assert.match(workouts, /Equipamento incompativel com o exercicio/);
  assert.match(workouts, /where: \{ id: \{ in: equipmentIds \}, gymId, active: true \}/);
});

test('AI0 G6 physically constrains AI creation to PENDING_REVIEW with no approver', async () => {
  const workouts = await source('src/modules/workouts/workouts.service.ts');
  const candidate = await source('src/modules/ai/ai-workout-candidate.service.ts');
  assert.match(workouts, /createdByAI: true/);
  assert.match(workouts, /status: 'PENDING_REVIEW'/);
  assert.match(workouts, /approvedById: null/);
  assert.match(workouts, /Treino criado por IA deve iniciar em PENDING_REVIEW/);
  assert.equal(candidate.includes('.updateStatus('), false);
  assert.equal(candidate.includes("status: 'ACTIVE'"), false);
  assert.equal(candidate.includes("status: 'APPROVED'"), false);
  assert.equal(candidate.includes('approvedById'), false);
});

test('AI0 G6 persists execution provenance and links it to the workout audit trail', async () => {
  const service = await source('src/modules/ai/ai-workout-candidate.service.ts');
  const workouts = await source('src/modules/workouts/workouts.service.ts');
  assert.match(service, /this\.persistence\.recordExecution/);
  assert.match(service, /AI_WORKOUT_CANDIDATE_LINKED/);
  assert.match(service, /aiExecutionTraceId: trace\.id/);
  assert.match(service, /requestId/);
  assert.match(workouts, /provenanceRequestId/);
  assert.match(workouts, /AI_WORKOUT_CANDIDATE_CREATED/);
});

test('AI0 G6 never mutates workouts on provider/configuration failure path', async () => {
  const service = await source('src/modules/ai/ai-workout-candidate.service.ts');
  const unavailable = service.indexOf("code: 'AI_WORKOUT_GENERATION_UNAVAILABLE'");
  const create = service.indexOf('this.workouts.createAiCandidate');
  assert.ok(unavailable >= 0 && create > unavailable);
  assert.match(service, /response\.status !== 'SUCCEEDED'/);
  assert.match(service, /AI_WORKOUT_GENERATION_INVALID_RESPONSE/);
});

test('AI0 G6 keeps human approval and activation in the canonical authenticated workout flow', async () => {
  const controller = await source('src/modules/workouts/workouts.controller.ts');
  const workouts = await source('src/modules/workouts/workouts.service.ts');
  assert.match(controller, /@Patch\(':id\/status'\)/);
  assert.match(controller, /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER'\)/);
  assert.match(workouts, /if \(status === 'APPROVED' \|\| status === 'ACTIVE'\)/);
  assert.match(workouts, /data\.approvedById = userId/);
});

test('AI0 G6 is wired without a new schema migration', async () => {
  const moduleSource = await source('src/modules/ai/ai.module.ts');
  const docs = await source('docs/AI0_G6_WORKOUT_CANDIDATE_HUMAN_REVIEW.md');
  assert.match(moduleSource, /AiWorkoutCandidateController/);
  assert.match(moduleSource, /AiWorkoutCandidateService/);
  assert.match(moduleSource, /WorkoutsModule/);
  assert.match(docs, /No migration is required for G6/);
});
