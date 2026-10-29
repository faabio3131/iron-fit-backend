import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/modules/manager-alerts/manager-alerts.service.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../src/modules/manager-alerts/manager-alerts.controller.ts', import.meta.url), 'utf8');
const preferenceDto = readFileSync(new URL('../src/modules/manager-alerts/dto/update-manager-alert-preference.dto.ts', import.meta.url), 'utf8');
const producers = readFileSync(new URL('../src/modules/manager-alerts/manager-alert-producers.service.ts', import.meta.url), 'utf8');
const dispatcher = readFileSync(new URL('../src/modules/manager-alerts/manager-alert-dispatch.service.ts', import.meta.url), 'utf8');
const evolution = readFileSync(new URL('../src/modules/manager-alerts/evolution-tenant-instance.service.ts', import.meta.url), 'utf8');
const authorization = readFileSync(new URL('../src/modules/manager-alerts/manager-alert-authorization.ts', import.meta.url), 'utf8');

test('manager alerts use tenant-scoped deduplication and recipient boundary', () => {
  assert.match(schema, /@@unique\(\[gymId, deduplicationKey\]\)/);
  assert.match(schema, /@@unique\(\[alertId, userId\]\)/);
  assert.match(service, /recipients: \{ some: \{ userId: actor\.id \} \}/);
  assert.match(service, /where: \{ alertId, userId, alert: \{ gymId, AND: \[managerAlertLiveAccess\(gymId, userId\)\]/);
});

test('all ten approved producer contracts map to the canonical ingest service', () => {
  for (const method of [
    'overdueStudentCharge', 'attendanceRisk', 'assessmentOrWorkoutPending',
    'equipmentProblem', 'deliveryFailure', 'integrationDegraded',
    'planLimitNear', 'suspiciousAccess', 'operationalIncident',
    'humanApprovalPending',
  ]) assert.match(producers, new RegExp(`${method}\\(`));
  assert.match(producers, /return this\.alerts\.ingest\(\{/);
  assert.match(producers, /createHash\('sha256'\)/);
  assert.doesNotMatch(producers, /metadata:/);
});

test('external outbox requires both tenant policy and individual opt-in', () => {
  assert.match(service, /policy\.emailAllowed && preference\.emailEnabled/);
  assert.match(service, /policy\.pushAllowed && preference\.pushEnabled/);
  assert.match(service, /policy\.whatsappAllowed && preference\.whatsappEnabled/);
  assert.match(service, /managerAlertDelivery\.createMany/);
  assert.match(service, /status: ManagerAlertDeliveryStatus\.PENDING/);
});

test('external dispatcher uses leases, retries and explicit dead letter state', () => {
  assert.match(dispatcher, /leaseOwner/);
  assert.match(dispatcher, /ManagerAlertDeliveryStatus\.DEAD_LETTER/);
  assert.match(dispatcher, /attemptCount: \{ lt: MAX_ATTEMPTS \}/);
  assert.match(dispatcher, /resolveForExternalBoundary/);
  assert.match(dispatcher, /PUSH_ADAPTER_NOT_IMPLEMENTED/);
  assert.doesNotMatch(dispatcher, /status: ManagerAlertDeliveryStatus\.SENT[\s\S]{0,200}catch/);
});

test('Evolution control plane keeps the global key server-side and isolates instances by gym', () => {
  assert.match(schema, /gymId\s+String\s+@unique[\s\S]*instanceName\s+String\s+@unique/);
  assert.match(evolution, /scope: IntegrationScope\.GLOBAL/);
  assert.match(evolution, /resolveForExternalBoundary\(connection\.id, \{ scope: 'GLOBAL' \}\)/);
  assert.match(evolution, /`iron-\$\{gymId\.replace/);
  assert.doesNotMatch(evolution, /return \{[^}]*credential/);
  assert.match(evolution, /syncFullHistory: false/);
  assert.match(evolution, /timingSafeEqual/);
  assert.match(evolution, /events: \['CONNECTION_UPDATE', 'QRCODE_UPDATED', 'MESSAGES_UPSERT'\]/);
  assert.doesNotMatch(evolution, /base64: true/);
});

test('individual preferences keep in-app mandatory and security non-silenceable', () => {
  assert.doesNotMatch(preferenceDto, /inAppEnabled/);
  assert.match(service, /category === ManagerAlertCategory\.SECURITY/);
  assert.match(service, /Alertas de seguranca nao podem ser filtrados/);
  assert.match(service, /Membership de gestor inativa ou inexistente/);
  assert.match(controller, /@Put\('preferences\/:category'\)/);
  assert.match(controller, /@Put\('policies\/:category'\)[\s\S]*@UseGuards\(StepUpGuard\)[\s\S]*@Roles\('OWNER'\)/);
  assert.match(service, /Politica de seguranca deve aceitar todas as severidades/);
});

test('sensitive categories are owner-only and ingestion is replay-safe', () => {
  assert.match(authorization, /ManagerAlertCategory\.STUDENT_BILLING/);
  assert.match(authorization, /ManagerAlertCategory\.SECURITY/);
  assert.match(authorization, /\? \[RoleName\.OWNER\]/);
  assert.match(service, /error\.code === 'P2002'/);
});

test('manager API is not a public producer and lifecycle is constrained', () => {
  assert.match(controller, /@Roles\('OWNER', 'MANAGER'\)/);
  assert.doesNotMatch(controller, /@Post/);
  assert.match(service, /updateMany\(\{/);
  assert.match(service, /status: current/);
  assert.match(service, /Transicao \$\{current\} -> \$\{target\} nao permitida/);
});
