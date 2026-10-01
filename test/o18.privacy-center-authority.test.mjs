import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(path, 'utf8');

test('O18 exposes authenticated self-service privacy consents without staff role escalation', async () => {
  const controller = await source('src/modules/privacy/privacy-governance.controller.ts');

  assert.match(controller, /@Controller\('privacy'\)/);
  assert.match(controller, /@UseGuards\(JwtAuthGuard, RolesGuard\)/);
  assert.match(controller, /@Get\('consents'\)/);
  assert.match(controller, /@Patch\('consents'\)/);

  const selfService = controller.slice(
    controller.indexOf("@Get('consents')"),
    controller.indexOf("@Get('legal-documents')"),
  );
  assert.doesNotMatch(selfService, /@Roles\(/);
  assert.match(selfService, /getMyConsents\(user\.id\)/);
  assert.match(selfService, /updateMyConsents\(user\.id, dto\)/);
});

test('O18 self-service consent authority is bound only to authenticated userId', async () => {
  const service = await source('src/modules/privacy/privacy-governance.service.ts');
  const section = service.slice(
    service.indexOf('async getMyConsents'),
    service.indexOf('async listLegalDocuments'),
  );

  assert.match(section, /where: \{ userId \}/);
  assert.doesNotMatch(section, /studentId: dto|gymId: dto|requestedGymId|activeGymId/);
  assert.match(section, /PRIVACY_SELF_CONSENTS_UPDATED/);
  assert.match(section, /gymId: previous\.gymId/);
  assert.match(section, /userId,/);
});

test('O18 preserves SUPER_ADMIN-only privacy operations and legal document authority', async () => {
  const controller = await source('src/modules/privacy/privacy-governance.controller.ts');
  const service = await source('src/modules/privacy/privacy-governance.service.ts');

  assert.match(
    controller,
    /@Get\('operations\/dsr'\)[\s\S]*?@Roles\('SUPER_ADMIN'\)/,
  );
  assert.match(
    controller,
    /@Post\('operations\/dsr\/:id\/review'\)[\s\S]*?@Roles\('SUPER_ADMIN'\)/,
  );
  assert.match(
    controller,
    /@Get\('operations\/governance'\)[\s\S]*?@Roles\('SUPER_ADMIN'\)/,
  );

  assert.match(service, /status: LegalDocumentStatus\.APPROVED/);
  assert.match(service, /approvedAt: \{ not: null \}/);
  assert.match(service, /contentHash/);
});

test('O18 self-service read model returns consent facts only', async () => {
  const service = await source('src/modules/privacy/privacy-governance.service.ts');
  const section = service.slice(
    service.indexOf('async getMyConsents'),
    service.indexOf('async updateMyConsents'),
  );

  for (const field of ['id: true', 'consentHealth: true', 'consentComm: true', 'consentBiometry: true']) {
    assert.equal(section.includes(field), true, field);
  }
  assert.equal(section.includes('user: true'), false);
  assert.equal(section.includes('passwordHash'), false);
});
