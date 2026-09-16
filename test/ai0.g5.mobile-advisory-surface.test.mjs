import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(path, 'utf8');
}

test('AI0 G5 exposes only the two canonical POST mobile advisory endpoints', async () => {
  const controller = await source('src/modules/ai/ai.controller.ts');
  assert.match(controller, /@Controller\('me\/ai'\)/);
  assert.match(controller, /@Post\('workout-insights'\)/);
  assert.match(controller, /@Post\('chat'\)/);
  assert.match(controller, /@UseGuards\(JwtAuthGuard, RolesGuard\)/);
  assert.match(controller, /@Roles\('STUDENT'\)/);
  assert.equal(controller.includes('@Get('), false);
});

test('AI0 G5 derives tenant only from authenticated identity', async () => {
  const service = await source('src/modules/ai/ai-mobile-advisory.service.ts');
  assert.match(service, /user\?\.activeGymId \?\? user\?\.gymId/);
  assert.equal(service.includes('dto.gymId'), false);
  assert.equal(service.includes('context.gymId'), false);
});

test('AI0 G5 treats mobile context as non-authoritative and rebuilds canonical context', async () => {
  const service = await source('src/modules/ai/ai-mobile-advisory.service.ts');
  assert.match(service, /buildStudentAdvisoryContext/);
  assert.match(service, /includeHealthData: false/);
  assert.equal(service.includes('dto.context'), false);
  assert.match(service, /this\.sanitizer\.sanitize/);
});

test('AI0 G5 gates both capabilities by canonical policy before provider execution', async () => {
  const service = await source('src/modules/ai/ai-mobile-advisory.service.ts');
  const workoutPolicy = service.indexOf("capability: 'WORKOUT_INSIGHTS'");
  const workoutExecution = service.indexOf("capability: 'WORKOUT_INSIGHTS'", workoutPolicy + 1);
  const chatPolicy = service.indexOf("capability: 'ADVISORY_CHAT'");
  const chatExecution = service.indexOf("capability: 'ADVISORY_CHAT'", chatPolicy + 1);
  assert.ok(workoutPolicy >= 0 && workoutExecution > workoutPolicy);
  assert.ok(chatPolicy >= 0 && chatExecution > chatPolicy);
  assert.match(service, /this\.policy\.assertAllowed/);
  assert.match(service, /this\.execution\.execute/);
});

test('AI0 G5 maps provider unavailability to safe mobile fallback semantics without leaking config', async () => {
  const service = await source('src/modules/ai/ai-mobile-advisory.service.ts');
  assert.match(service, /AI_ADVISORY_UNAVAILABLE/);
  assert.match(service, /ServiceUnavailableException/);
  for (const forbidden of ['providerCode', 'modelCode', 'secretReference', 'endpoint:']) {
    assert.equal(service.includes(forbidden), false);
  }
});

test('AI0 G5 validates successful advisory output and keeps G6 out of scope', async () => {
  const service = await source('src/modules/ai/ai-mobile-advisory.service.ts');
  assert.match(service, /validateAdvisoryOutput/);
  assert.match(service, /response\.status !== 'SUCCEEDED'/);
  const docs = await source('docs/AI0_G5_MOBILE_ADVISORY_SURFACE.md');
  assert.match(docs, /G6\/workout candidate não foi iniciado/);
  for (const forbidden of ['WORKOUT_GENERATION', 'createWorkout', 'approveWorkout', 'candidateId']) {
    assert.equal(service.includes(forbidden), false);
  }
});

test('AI0 G5 is wired into the application module and requires no new migration', async () => {
  const app = await source('src/app.module.ts');
  const moduleSource = await source('src/modules/ai/ai.module.ts');
  assert.match(app, /AiModule/);
  assert.match(moduleSource, /controllers: \[AiController\]/);
  assert.match(moduleSource, /AiMobileAdvisoryService/);
});
