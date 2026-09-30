import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(path, 'utf8');

test('AI-GAP-1 keeps ai.content_recommendation commercially LAUNCH and entitled', async () => {
  const manifest = JSON.parse(
    await source('config/commercial/iron-v1-launch.json'),
  );
  const launch = manifest.launchItems.find(
    (item) => item.itemKey === 'ai.content_recommendation',
  );
  assert.equal(launch?.decision, 'LAUNCH');
  assert.equal(launch?.featureKey, 'ai.content_recommendation');
  for (const plan of manifest.plans) {
    const entitlement = plan.entitlements.find(
      (item) => item.featureKey === 'ai.content_recommendation',
    );
    assert.equal(entitlement?.featureEnabled, true);
  }
});

test('AI-GAP-1 exposes a real student content recommendation runtime', async () => {
  const controller = await source('src/modules/ai/ai.controller.ts');
  const service = await source('src/modules/ai/ai-mobile-advisory.service.ts');

  assert.match(controller, /@Post\('content-recommendations'\)/);
  assert.match(service, /capability: 'CONTENT_RECOMMENDATION'/);
  assert.match(service, /promptKey: 'student\.content_recommendation'/);
  assert.match(service, /buildStudentContentRecommendationContext/);
  assert.match(service, /resolveEligibleExerciseContent/);
  assert.match(service, /advisory: true/);
});

test('AI-GAP-1 derives candidates only from authenticated student canonical workouts', async () => {
  const context = await source(
    'src/modules/ai/context/ai-context-builder.service.ts',
  );

  assert.match(context, /gymId: request\.gymId/);
  assert.match(context, /userId: request\.userId/);
  assert.match(context, /status: 'ACTIVE'/);
  assert.match(context, /status: \{ in: \['ACTIVE', 'APPROVED'\] \}/);
  assert.match(
    context,
    /Exercicio solicitado nao pertence ao treino ativo\/aprovado do aluno/,
  );
  assert.match(context, /resolveEligibleExerciseContent/);
  assert.doesNotMatch(context, /videoUrl: true/);
});

test('AI-GAP-1 never trusts provider URLs and re-resolves final content canonically', async () => {
  const service = await source('src/modules/ai/ai-mobile-advisory.service.ts');
  const validator = await source(
    'src/modules/ai/validation/ai-output-validator.service.ts',
  );

  assert.match(service, /requireValidatedOutput/);
  assert.match(
    service,
    /Resposta AI referencia exercicio fora do contexto canonico/,
  );
  assert.match(service, /resolveEligibleExerciseContent/);
  assert.match(validator, /MODEL_URL_REJECTED/);
  assert.match(validator, /AUTHORITY_MUTATION_REJECTED/);
});

test('AI-GAP-1 remains governed by entitlement and Vault capability isolation', async () => {
  const policy = await source('src/modules/ai/policy/ai-policy-guard.service.ts');
  const secret = await source(
    'src/modules/ai/secrets/ai-secret-reference.service.ts',
  );

  assert.match(
    policy,
    /CONTENT_RECOMMENDATION: 'ai\.content_recommendation'/,
  );
  assert.match(policy, /resolveFeatureForUser/);
  assert.match(secret, /CONTENT_RECOMMENDATION/);
  assert.match(secret, /ai\.content_recommendation/);
});
