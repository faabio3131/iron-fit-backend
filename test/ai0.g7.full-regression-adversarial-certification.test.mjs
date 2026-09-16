import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(path, 'utf8');
}

const paths = {
  mobileController: 'src/modules/ai/ai.controller.ts',
  mobileService: 'src/modules/ai/ai-mobile-advisory.service.ts',
  candidateController: 'src/modules/ai/ai-workout-candidate.controller.ts',
  candidateService: 'src/modules/ai/ai-workout-candidate.service.ts',
  context: 'src/modules/ai/context/ai-context-builder.service.ts',
  sanitizer: 'src/modules/ai/security/ai-sanitizer.service.ts',
  policy: 'src/modules/ai/policy/ai-policy-guard.service.ts',
  validator: 'src/modules/ai/validation/ai-output-validator.service.ts',
  execution: 'src/modules/ai/runtime/ai-provider-execution.service.ts',
  nullProvider: 'src/modules/ai/providers/null-ai-provider.adapter.ts',
  persistence: 'src/modules/ai/ai-persistence.service.ts',
  workouts: 'src/modules/workouts/workouts.service.ts',
  workoutsController: 'src/modules/workouts/workouts.controller.ts',
  assessmentsController: 'src/modules/assessments/assessments.controller.ts',
};

test('G7 cross-tenant: AI surfaces derive tenant from authenticated identity and server-side context filters by gym', async () => {
  const mobileController = await source(paths.mobileController);
  const candidateController = await source(paths.candidateController);
  const candidate = await source(paths.candidateService);
  const context = await source(paths.context);

  assert.match(mobileController, /resolveTenantOperationGymId/);
  assert.match(candidateController, /resolveTenantOperationGymId/);
  assert.equal(mobileController.includes('dto.gymId'), false);
  assert.equal(candidateController.includes('dto.gymId'), false);
  assert.equal(candidate.includes('dto.gymId'), false);
  assert.match(context, /gymId: request\.gymId/);
  assert.match(context, /where:[\s\S]*?gymId: request\.gymId/);
});

test('G7 prompt-injection boundary: untrusted instructions remain input, never provider prompt metadata or authority', async () => {
  const candidate = await source(paths.candidateService);
  const mobile = await source(paths.mobileService);

  assert.match(candidate, /instructions: dto\.instructions/);
  assert.match(candidate, /this\.sanitizer\.sanitize/);
  assert.match(candidate, /prompt: \{ promptKey: 'workout\.candidate_generation', promptVersion: 1 \}/);
  assert.equal(candidate.includes('prompt: dto.instructions'), false);
  assert.equal(mobile.includes('prompt: dto.context'), false);
  assert.equal(mobile.includes('tenantId: dto'), false);
});

test('G7 context exfiltration and secret injection: sanitizer strips credential, token, finance and fiscal material', async () => {
  const sanitizer = await source(paths.sanitizer);
  assert.match(sanitizer, /access\.?token/);
  assert.match(sanitizer, /refresh\.?token/);
  assert.match(sanitizer, /authorization/);
  assert.match(sanitizer, /password/);
  assert.match(sanitizer, /api\.\?key/);
  assert.match(sanitizer, /secret/);
  assert.match(sanitizer, /financial/);
  assert.match(sanitizer, /fiscal/);
  assert.match(sanitizer, /Bearer/);
  assert.match(sanitizer, /JWT_PATTERN/);
  assert.match(sanitizer, /CARD_PATTERN/);
  assert.match(sanitizer, /\[REDACTED\]/);
});

test('G7 entitlement/RBAC fail closed before provider execution', async () => {
  const candidate = await source(paths.candidateService);
  const policy = await source(paths.policy);
  const controller = await source(paths.candidateController);

  const guard = candidate.indexOf('this.policy.assertAllowed');
  const execute = candidate.indexOf('this.execution.execute');
  assert.ok(guard >= 0 && execute > guard);
  assert.match(candidate, /capability: 'WORKOUT_GENERATION'/);
  assert.match(policy, /resolveFeature/);
  assert.match(policy, /allowed/);
  assert.match(controller, /@Roles\('SUPER_ADMIN', 'OWNER', 'MANAGER', 'TRAINER'\)/);
  assert.equal(controller.includes("@Roles('STUDENT')"), false);
});

test('G7 provider down, timeout and budget/configuration failures normalize safely', async () => {
  const execution = await source(paths.execution);
  const nullProvider = await source(paths.nullProvider);
  const mobile = await source(paths.mobileService);
  const candidate = await source(paths.candidateService);

  assert.match(execution, /TIMEOUT|timeout/i);
  assert.match(execution, /BUDGET|budget/i);
  assert.match(execution, /UNAVAILABLE|unavailable/i);
  assert.match(nullProvider, /UNAVAILABLE|unavailable/i);
  assert.match(mobile, /ServiceUnavailableException/);
  assert.match(candidate, /AI_WORKOUT_GENERATION_UNAVAILABLE/);
});

test('G7 malformed output and authority mutation are rejected before domain mutation', async () => {
  const validator = await source(paths.validator);
  const candidate = await source(paths.candidateService);

  assert.match(validator, /FORBIDDEN_AUTHORITY_KEYS/);
  for (const key of ['approvedById', 'status', 'payment', 'financial', 'fiscal', 'accessAuthorization', 'entitlement', 'rightsGrant', 'publish']) {
    assert.ok(validator.includes(`'${key}'`), `missing forbidden authority key ${key}`);
  }
  assert.match(validator, /AUTHORITY_MUTATION_REJECTED/);
  assert.match(validator, /MODEL_URL_REJECTED/);
  assert.match(candidate, /AI_WORKOUT_GENERATION_INVALID_RESPONSE/);
  assert.ok(candidate.indexOf('validateAdvisoryOutput') < candidate.indexOf('this.workouts.createAiCandidate'));
});

test('G7 equipment and content references stay delegated to canonical EQ/CN resolvers', async () => {
  const validator = await source(paths.validator);
  assert.match(validator, /findCompatibleForExercise/);
  assert.match(validator, /EQUIPMENT_NOT_ELIGIBLE/);
  assert.match(validator, /resolveExerciseContent/);
  assert.match(validator, /CONTENT_NOT_ELIGIBLE/);
  assert.match(validator, /resolved\.kind !== 'MANAGED_CONTENT'/);
});

test('G7 human review is non-bypassable by AI service', async () => {
  const candidate = await source(paths.candidateService);
  const workouts = await source(paths.workouts);
  const controller = await source(paths.workoutsController);

  assert.equal(candidate.includes('.updateStatus('), false);
  assert.equal(candidate.includes("status: 'ACTIVE'"), false);
  assert.equal(candidate.includes("status: 'APPROVED'"), false);
  assert.equal(candidate.includes('approvedById'), false);
  assert.match(workouts, /createdByAI: true/);
  assert.match(workouts, /status: 'PENDING_REVIEW'/);
  assert.match(workouts, /approvedById: null/);
  assert.match(controller, /@Patch\(':id\/status'\)/);
  assert.match(workouts, /data\.approvedById = userId/);
});

test('G7 provenance/logging stores hashes and metadata rather than raw provider payload', async () => {
  const persistence = await source(paths.persistence);
  const candidate = await source(paths.candidateService);

  assert.match(candidate, /inputHash: this\.hash\(input\)/);
  assert.match(candidate, /outputHash: this\.hash\(response\.output\)/);
  assert.match(candidate, /requestId/);
  assert.match(persistence, /inputHash/);
  assert.match(persistence, /outputHash/);
  assert.equal(/data:\s*\{[\s\S]*?raw(Input|Output|Prompt|Response)/i.test(persistence), false);
});

test('G7 deterministic workout and assessment APIs do not depend on AI availability', async () => {
  const workoutsController = await source(paths.workoutsController);
  const assessmentsController = await source(paths.assessmentsController);
  assert.equal(workoutsController.includes('AiProvider'), false);
  assert.equal(workoutsController.includes('AiMobileAdvisory'), false);
  assert.equal(assessmentsController.includes('AiProvider'), false);
  assert.equal(assessmentsController.includes('AiMobileAdvisory'), false);
});

test('G7 mobile advisory remains optional and safely unavailable for app fallback', async () => {
  const mobile = await source(paths.mobileService);
  const controller = await source(paths.mobileController);
  assert.match(controller, /@Post\('workout-insights'\)/);
  assert.match(controller, /@Post\('chat'\)/);
  assert.match(mobile, /ServiceUnavailableException/);
  assert.match(mobile, /AI_[A-Z_]+_UNAVAILABLE/);
});

test('G7 certification scope has no schema migration and preserves AI0 provider-neutral boundaries', async () => {
  const docs = await source('docs/AI0_G7_FULL_REGRESSION_ADVERSARIAL_CERTIFICATION.md');
  assert.match(docs, /No migration is required for G7/);
  assert.match(docs, /G1-G7/);
  assert.match(docs, /cross-tenant/i);
  assert.match(docs, /prompt injection/i);
  assert.match(docs, /human review/i);
  assert.match(docs, /provider-neutral/i);
});
