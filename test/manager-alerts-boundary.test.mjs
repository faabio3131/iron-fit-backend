import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/modules/manager-alerts/manager-alerts.service.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../src/modules/manager-alerts/manager-alerts.controller.ts', import.meta.url), 'utf8');
const preferenceDto = readFileSync(new URL('../src/modules/manager-alerts/dto/update-manager-alert-preference.dto.ts', import.meta.url), 'utf8');
const producers = readFileSync(new URL('../src/modules/manager-alerts/manager-alert-producers.service.ts', import.meta.url), 'utf8');

test('manager alerts use tenant-scoped deduplication and recipient boundary', () => {
  assert.match(schema, /@@unique\(\[gymId, deduplicationKey\]\)/);
  assert.match(schema, /@@unique\(\[alertId, userId\]\)/);
  assert.match(service, /recipients: \{ some: \{ userId: actor\.id \} \}/);
  assert.match(service, /where: \{ alertId, userId, alert: \{ gymId \} \}/);
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
  assert.match(service, /ManagerAlertCategory\.STUDENT_BILLING/);
  assert.match(service, /ManagerAlertCategory\.SECURITY/);
  assert.match(service, /\? \[RoleName\.OWNER\]/);
  assert.match(service, /error\.code === 'P2002'/);
});

test('manager API is not a public producer and lifecycle is constrained', () => {
  assert.match(controller, /@Roles\('OWNER', 'MANAGER'\)/);
  assert.doesNotMatch(controller, /@Post/);
  assert.match(service, /updateMany\(\{/);
  assert.match(service, /status: current/);
  assert.match(service, /Transicao \$\{current\} -> \$\{target\} nao permitida/);
});
