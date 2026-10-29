import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (process.env.IRON_MANAGER_ALERTS_DB_CERTIFY !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.IRON_RUNTIME_ENV !== 'HOMOLOG' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/iron_ci') {
  throw new Error('Manager alerts certification requires the explicit disposable local iron_ci database');
}
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { AuditService } = require('../dist/src/common/audit/audit.service.js');
const { ManagerAlertsService } = require('../dist/src/modules/manager-alerts/manager-alerts.service.js');
const { ManagerAlertProducersService } = require('../dist/src/modules/manager-alerts/manager-alert-producers.service.js');
const { ManagerAlertSourceScanService } = require('../dist/src/modules/manager-alerts/manager-alert-source-scan.service.js');
const { ManagerAlertBusinessScanService } = require('../dist/src/modules/manager-alerts/manager-alert-business-scan.service.js');
const { EquipmentsService } = require('../dist/src/modules/equipments/equipments.service.js');
const { ManagerAlertDispatchService } = require('../dist/src/modules/manager-alerts/manager-alert-dispatch.service.js');
const db = new PrismaClient();
const gymIds = [], userIds = [], connectionIds = [];
const suffix = randomUUID();
try {
  const a = await db.gym.create({ data: { name: 'Alerts disposable A', slug: 'alerts-a-' + suffix } }); gymIds.push(a.id);
  const b = await db.gym.create({ data: { name: 'Alerts disposable B', slug: 'alerts-b-' + suffix } }); gymIds.push(b.id);
  const identities = [];
  for (const [label, gym, roleName] of [['owner-a', a, 'OWNER'], ['manager-a', a, 'MANAGER'], ['owner-b', b, 'OWNER']]) {
    const role = await db.role.upsert({ where: { name: roleName }, create: { name: roleName }, update: {} });
    const user = await db.user.create({ data: { email: `${label}-${suffix}@invalid.example`, name: label, passwordHash: 'synthetic-non-login-fixture' } }); userIds.push(user.id);
    await db.userRole.create({ data: { gymId: gym.id, userId: user.id, roleId: role.id } });
    identities.push({ id: user.id, roles: [roleName], activeGymId: gym.id });
  }
  const [ownerA, managerA, ownerB] = identities;
  const audit = new AuditService(db);
  const alerts = new ManagerAlertsService(db, audit);
  const producers = new ManagerAlertProducersService(alerts);
  const old = new Date(Date.now() - 30 * 86_400_000);
  const student = await db.student.create({ data: { gymId: a.id } });
  await db.charge.create({ data: { gymId: a.id, studentId: student.id, amount: 100, dueDate: old, status: 'PENDING' } });
  await db.charge.create({ data: { gymId: a.id, studentId: student.id, amount: 200, status: 'FAILED' } });
  await db.workout.create({ data: { studentId: student.id, status: 'PENDING_REVIEW', createdByAI: true } });
  await db.communicationMessage.create({ data: { gymId: a.id, studentId: student.id, channel: 'WHATSAPP', status: 'FAILED', body: 'synthetic message must not enter alerts', dispatchKey: suffix } });
  const connection = await db.integrationConnection.create({ data: { scope: 'TENANT', gymId: a.id, providerCode: 'synthetic-alerts', environment: 'HOMOLOG', authModel: 'API_KEY', capabilities: [], status: 'DEGRADED' } }); connectionIds.push(connection.id);
  await db.accessEvent.createMany({ data: [
    { gymId: a.id, studentId: student.id, allowed: true, occurredAt: old },
    { gymId: a.id, allowed: false, denialReason: 'Replay detectado' },
  ] });
  const equipment = await db.equipment.create({ data: { gymId: a.id, name: 'Synthetic equipment' } });
  // This persistence fixture supplies a granted capability; real trial grants are exercised by HTTP E2E.
  await new EquipmentsService(db, audit, { resolveFeature: async () => ({ kind: 'FEATURE', value: true }) }).updateOperationalStatus(equipment.id, a.id, ownerA.id, 'MAINTENANCE');
  await audit.record({ gymId: a.id, action: 'MEDIA_INGESTION_FAILED', entity: 'SyntheticMedia', entityId: suffix });
  const source = new ManagerAlertSourceScanService(db, producers, { current: () => 'HOMOLOG' });
  const business = new ManagerAlertBusinessScanService(db, producers, { resolveFeature: async () => { throw new Error('No trial fixture'); } }, { get: () => undefined });
  await source.scanDue(100);
  await business.scanDue(100);
  const before = await db.managerAlert.count({ where: { gymId: a.id } });
  assert.equal(before, 10, 'ten facts from real DB sources including a separate payment failure (trial quota separately unit-tested)');
  await source.scanDue(100);
  await business.scanDue(100);
  assert.equal(await db.managerAlert.count({ where: { gymId: a.id } }), before, 'source replay must not duplicate rows');
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => producers.operationalIncident({ gymId: a.id, eventId: suffix })));
  assert.equal(concurrent.filter((result) => !result.replayed).length, 1, 'concurrent ingest must create one row');
  const financial = await db.managerAlert.findFirstOrThrow({ where: { gymId: a.id, category: 'STUDENT_BILLING' }, include: { recipients: true } });
  assert.deepEqual(financial.recipients.map((recipient) => recipient.userId), [ownerA.id]);
  await assert.rejects(alerts.markRead(financial.id, ownerB), (error) => error.getStatus() === 404);
  await assert.rejects(alerts.markRead(financial.id, managerA), (error) => error.getStatus() === 404);
  const managerRole = await db.role.findUniqueOrThrow({ where: { name: 'MANAGER' } });
  await db.userRole.updateMany({ where: { gymId: a.id, userId: ownerA.id }, data: { roleId: managerRole.id } });
  await assert.rejects(alerts.markRead(financial.id, ownerA), (error) => error.getStatus() === 404);
  const inbox = await alerts.list(ownerA, { limit: 100, offset: 0 });
  assert.equal(inbox.items.some((row) => ['STUDENT_BILLING', 'SECURITY'].includes(row.category)), false, 'historical OWNER recipient must not retain financial/security access after demotion');
  for (const attemptCount of [1, 5]) {
    await db.managerAlertDelivery.create({ data: { alertId: financial.id, recipientId: financial.recipients[0].id, channel: attemptCount === 1 ? 'EMAIL' : 'WHATSAPP', status: 'SENDING', attemptCount, leaseOwner: 'expired-worker', leaseUntil: old, idempotencyKey: `${suffix}:${attemptCount}` } });
  }
  const dispatcher = new ManagerAlertDispatchService(db, {}, {}, {}, {}, {}, audit);
  await dispatcher.dispatchDue(100);
  const recovered = await db.managerAlertDelivery.findMany({ where: { alertId: financial.id } });
  assert.ok(recovered.some((row) => row.status === 'SKIPPED' && row.attemptCount === 1));
  assert.ok(recovered.some((row) => row.status === 'DEAD_LETTER' && row.attemptCount === 5));
  const rows = await db.managerAlert.findMany({ where: { gymId: a.id } });
  assert.equal(JSON.stringify(rows).includes('synthetic message must not enter alerts'), false);
  assert.equal(await db.managerAlert.count({ where: { gymId: b.id } }), 0);
  console.log('MANAGER_ALERTS_DB_CERTIFIED: committed sources, maintenance mutation, replay, concurrent dedupe, OWNER financial isolation, cross-tenant denial, payload minimization');
} finally {
  await db.auditLog.deleteMany({ where: { gymId: { in: gymIds } } });
  await db.integrationConnection.deleteMany({ where: { id: { in: connectionIds } } });
  await db.gym.deleteMany({ where: { id: { in: gymIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
}
