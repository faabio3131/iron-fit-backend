import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const canonicalSuites = [
  's0.smoke.test.mjs',
  's1.tenant-context.test.mjs',
  's2.rbac.test.mjs',
  's3.student-identity.test.mjs',
  's4.portal-ownership.test.mjs',
  's5.tenant-scheduling-communication.test.mjs',
  's6.access-chain.test.mjs',
  's7.financial-security.test.mjs',
  's8.production-auth.test.mjs',
  's9.api-hardening.test.mjs',
  's10.health-observability-runtime.test.mjs',
  's11.audit-lgpd.test.mjs',
];

test('S12 includes every canonical S0-S11 regression suite with no explicit skipped critical tests', async () => {
  const files = await readdir('test');
  for (const suite of canonicalSuites) {
    assert.equal(files.includes(suite), true, `missing canonical suite ${suite}`);
    const source = await readFile(`test/${suite}`, 'utf8');
    assert.equal(/(?:test|describe|it)\.skip\s*\(/.test(source), false, `${suite} contains explicit skip`);
  }
});

test('S12 permanent CI gate keeps dependency audit, Prisma, lint, build and full smoke matrix', async () => {
  const workflow = await readFile('.github/workflows/iron-s0-quality.yml', 'utf8');
  for (const required of [
    'npm ci',
    'npm audit --audit-level=high',
    'npx prisma generate',
    'npm run lint',
    'npm run build',
    'npm run test:smoke',
  ]) {
    assert.equal(workflow.includes(required), true, `missing CI gate ${required}`);
  }
});

test('S12 financial idempotency is enforced by Prisma schema and explicit fail-closed migration', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  const migration = await readFile(
    'prisma/migrations/20260904204000_financial_source_idempotency_unique/migration.sql',
    'utf8',
  );

  assert.equal(schema.includes('@@unique([gymId, source, sourceId])'), true);
  assert.equal(migration.includes('HAVING COUNT(*) > 1'), true);
  assert.equal(migration.includes('RAISE EXCEPTION'), true);
  assert.equal(
    migration.includes('CREATE UNIQUE INDEX "FinancialTransaction_gymId_source_sourceId_key"'),
    true,
  );
});

test('S12 access denial never persists or returns a foreign-tenant student identity', async () => {
  const source = await readFile('src/modules/access/access.service.ts', 'utf8');
  assert.equal(source.includes('const safeStudentId = credentialBelongsToGym'), true);
  assert.equal(source.includes('studentId: safeStudentId'), true);
  assert.equal(source.includes('student: allowed && credentialBelongsToGym && credential'), true);
});

test('S12 workouts and assessments require explicit tenant operation scope', async () => {
  const workoutController = await readFile('src/modules/workouts/workouts.controller.ts', 'utf8');
  const workoutService = await readFile('src/modules/workouts/workouts.service.ts', 'utf8');
  const assessmentController = await readFile('src/modules/assessments/assessments.controller.ts', 'utf8');
  const assessmentService = await readFile('src/modules/assessments/assessments.service.ts', 'utf8');

  assert.equal(workoutController.includes('resolveTenantOperationGymId'), true);
  assert.equal(assessmentController.includes('resolveTenantOperationGymId'), true);
  assert.equal(workoutService.includes("throw new BadRequestException('Tenant ativo obrigatorio')"), true);
  assert.equal(assessmentService.includes("throw new BadRequestException('Tenant ativo obrigatorio')"), true);
});

test('S12 critical mutation domains emit central AuditLog actions', async () => {
  const expectations = [
    ['src/modules/auth/auth.service.ts', 'AUTH_LOGIN_SUCCESS'],
    ['src/modules/users/users.service.ts', 'USER_ROLE_ASSIGNED'],
    ['src/modules/gyms/gyms.service.ts', 'GYM_CREATED'],
    ['src/modules/students/students.service.ts', 'STUDENT_CONSENTS_UPDATED'],
    ['src/modules/assessments/assessments.service.ts', 'ASSESSMENT_CREATED'],
    ['src/modules/workouts/workouts.service.ts', 'WORKOUT_STATUS_UPDATED'],
    ['src/modules/access/access.service.ts', 'ACCESS_DECISION_RECORDED'],
    ['src/modules/financial/financial.service.ts', 'FINANCIAL_CHARGE_PAID'],
  ];

  for (const [path, action] of expectations) {
    const source = await readFile(path, 'utf8');
    assert.equal(source.includes(action), true, `${path} missing ${action}`);
  }
});

test('S12 workout creation rejects cross-tenant assessment and equipment links by scoped lookup', async () => {
  const source = await readFile('src/modules/workouts/workouts.service.ts', 'utf8');
  assert.equal(source.includes('student: { gymId }'), true);
  assert.equal(source.includes("where: { id: { in: equipmentIds }, gymId, active: true }"), true);
  assert.equal(source.includes("throw new NotFoundException('Equipamento nao encontrado')"), true);
});
