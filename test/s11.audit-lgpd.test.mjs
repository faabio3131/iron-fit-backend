import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(path, 'utf8');
}

test('S11 central audit service records actor tenant action entity and prev/next', async () => {
  const audit = await source('src/common/audit/audit.service.ts');
  assert.equal(audit.includes('gymId'), true);
  assert.equal(audit.includes('userId'), true);
  assert.equal(audit.includes('action'), true);
  assert.equal(audit.includes('entity'), true);
  assert.equal(audit.includes('entityId'), true);
  assert.equal(audit.includes('previous'), true);
  assert.equal(audit.includes('next'), true);
  assert.equal(audit.includes('auditLog.create'), true);
});

test('S11 audit sanitizer explicitly redacts sensitive credential material', async () => {
  const audit = await source('src/common/audit/audit.service.ts');
  for (const token of [
    'passwordHash',
    'refreshTokenHash',
    'authorization',
    'cookie',
    'mfaSecret',
    'apiKeyEnc',
    'accessTokenEnc',
    'webhookSecretEnc',
  ]) {
    assert.equal(audit.includes(`'${token}'`), true);
  }
  assert.equal(audit.includes("'[REDACTED]'"), true);
});

test('S11 student consent mutation is tenant scoped and audited atomically', async () => {
  const students = await source('src/modules/students/students.service.ts');
  assert.equal(students.includes('where: { id, gymId }'), true);
  assert.equal(students.includes("action: 'STUDENT_CONSENTS_UPDATED'"), true);
  assert.equal(students.includes('previous:'), true);
  assert.equal(students.includes('next: updated'), true);
  assert.equal(students.includes('this.prisma.$transaction(async (tx)'), true);
  assert.equal(students.includes('}, tx);'), true);
});

test('S11 consent endpoint does not accept gymId from request body as authority', async () => {
  const controller = await source('src/modules/students/students.controller.ts');
  const dto = await source('src/modules/students/dto/update-consents.dto.ts');
  assert.equal(controller.includes("@Patch(':id/consents')"), true);
  assert.equal(controller.includes('user.activeGymId ?? user.gymId'), true);
  assert.equal(dto.includes('gymId'), false);
  assert.equal(dto.includes('consentHealth'), true);
  assert.equal(dto.includes('consentComm'), true);
  assert.equal(dto.includes('consentBiometry'), true);
});

test('S11 documents LGPD retention and data subject rights without enabling blind deletion', async () => {
  const docs = await source('docs/S11_LGPD_RETENTION_RIGHTS.md');
  assert.equal(docs.includes('Direitos do titular'), true);
  assert.equal(docs.includes('Retenção'), true);
  assert.equal(docs.includes('nenhuma rotina automática de exclusão definitiva deve ser ativada'), true);
  assert.equal(docs.includes('revogação'), true);
});
