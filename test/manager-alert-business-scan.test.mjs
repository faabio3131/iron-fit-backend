import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ManagerAlertBusinessScanService } = require('../dist/src/modules/manager-alerts/manager-alert-business-scan.service.js');
const { EquipmentsService } = require('../dist/src/modules/equipments/equipments.service.js');
const now = new Date('2026-10-29T12:00:00Z');
const old = new Date('2026-10-01T12:00:00Z');

function fixture() {
  const calls = [];
  const queries = {};
  const prisma = {
    equipment: { findMany: async (q) => { queries.equipment = q; return [{ id: 'e', gymId: 'a', operationalStatusChangedAt: old }]; } },
    student: {
      findMany: async (q) => { queries.student = q; return [
        { id: 's1', gymId: 'b', accessEvents: [{ occurredAt: old }], schedules: [] },
        { id: 's2', gymId: 'b', accessEvents: [], schedules: [] },
        { id: 's3', gymId: 'b', accessEvents: [{ occurredAt: old }], schedules: [{ checkedInAt: now }] },
      ]; },
      count: async (q) => { queries.count = q; return 12; },
    },
    commercialTrialProvisioning: { findMany: async () => [{ requestId: 'p', gymId: 'c', subscriptionId: 'sub' }] },
    tenantProductSubscription: { findFirst: async (q) => { queries.subscription = q; return { id: 'sub' }; } },
    auditLog: { findMany: async (q) => { queries.audit = q; return [{ id: 'log', gymId: 'd', entity: 'AggregatorRevalidationAttempt', entityId: 'attempt', createdAt: old }]; } },
  };
  const producers = Object.fromEntries(['equipmentProblem', 'attendanceRisk', 'planLimitNear', 'operationalIncident'].map((key) => [key, async (event) => calls.push({ key, ...event })]));
  const entitlements = { resolveFeature: async (gym, key) => { assert.equal(gym, 'c'); assert.equal(key, 'commercial.trial_students_max'); return { kind: 'LIMIT', value: 15 }; } };
  const scan = new ManagerAlertBusinessScanService(prisma, producers, entitlements, { get: () => undefined });
  return { scan, prisma, calls, queries, entitlements };
}

test('business signals use actual maintenance, known presence, canonical trial cap and audited incidents', async () => {
  const { scan, calls, queries } = fixture();
  await scan.scanDue(50, now);
  assert.deepEqual(calls.map((c) => c.key).sort(), ['attendanceRisk', 'equipmentProblem', 'operationalIncident', 'planLimitNear']);
  assert.equal(calls.find((c) => c.key === 'attendanceRisk').resourceId, 's1', 'unknown history and recent check-in cannot create an inactivity alert');
  assert.deepEqual(queries.equipment.where.operationalStatus.in, ['MAINTENANCE', 'OUT_OF_SERVICE']);
  assert.ok(!('active' in queries.equipment.where), 'selection state does not mean a defect');
  assert.deepEqual(queries.count.where, { gymId: 'c', status: { not: 'CANCELED' } });
  assert.equal(queries.subscription.where.gymId, 'c');
  assert.equal(queries.subscription.where.status, 'ACTIVE');
  assert.ok(calls.find((c) => c.key === 'planLimitNear').summary.includes('12 de 15'));
  assert.equal(calls.find((c) => c.key === 'operationalIncident').resourceType, 'AggregatorRevalidationAttempt');
  assert.ok(queries.audit.where.action.in.every((action) => !action.startsWith('MANAGER_ALERT')));
  assert.ok(!('next' in queries.audit.select) && !('previous' in queries.audit.select));
  const original = structuredClone(calls);
  await scan.scanDue(50, now);
  assert.deepEqual(calls.slice(4), original, 'stable events survive restart/replay without inventing new events');
});

test('unknown or missing entitlement is not converted into zero; other signal families still run', async () => {
  const { scan, calls, entitlements } = fixture();
  entitlements.resolveFeature = async () => ({ kind: 'FEATURE', value: false });
  await assert.rejects(scan.scanDue(50, now), /MANAGER_ALERT_BUSINESS_SCAN_FAILED/);
  assert.equal(calls.filter((c) => c.key === 'planLimitNear').length, 0);
  assert.equal(calls.filter((c) => c.key === 'equipmentProblem').length, 1);
});

test('expired subscription and consumption below threshold do not generate plan alerts', async () => {
  const { scan, calls, prisma } = fixture();
  prisma.tenantProductSubscription.findFirst = async () => null;
  await scan.scanDue(50, now);
  assert.equal(calls.filter((c) => c.key === 'planLimitNear').length, 0);
  prisma.tenantProductSubscription.findFirst = async () => ({ id: 'sub' });
  prisma.student.count = async () => 11;
  await scan.scanDue(50, now);
  assert.equal(calls.filter((c) => c.key === 'planLimitNear').length, 0);
});

test('equipment operational mutation rejects foreign tenant and stale changes and audits only committed changes', async () => {
  let record = null;
  let count = 0;
  let audits = 0;
  const tx = { equipment: {
    findFirst: async ({ where }) => { assert.deepEqual(where, { id: 'equipment-a', gymId: 'gym-a' }); return record; },
    updateMany: async ({ where, data }) => { assert.equal(where.gymId, 'gym-a'); assert.equal(where.operationalStatus, 'OPERATIONAL'); assert.equal(data.operationalStatus, 'MAINTENANCE'); return { count }; },
    findFirstOrThrow: async () => ({ id: 'equipment-a', operationalStatus: 'MAINTENANCE' }),
  } };
  const service = new EquipmentsService({ gym: { findFirst: async () => ({ id: 'gym-a' }) }, $transaction: async (fn) => fn(tx) }, { record: async (_event, db) => { assert.equal(db, tx); audits++; } });
  await assert.rejects(service.updateOperationalStatus('equipment-a', 'gym-a', 'owner', 'MAINTENANCE'), (e) => e.getStatus() === 404);
  record = { operationalStatus: 'OPERATIONAL', operationalStatusChangedAt: null };
  await assert.rejects(service.updateOperationalStatus('equipment-a', 'gym-a', 'owner', 'MAINTENANCE'), (e) => e.getStatus() === 409);
  assert.equal(audits, 0);
  count = 1;
  const result = await service.updateOperationalStatus('equipment-a', 'gym-a', 'owner', 'MAINTENANCE');
  assert.equal(result.operationalStatus, 'MAINTENANCE');
  assert.equal(audits, 1);
  record = { operationalStatus: 'MAINTENANCE' };
  await service.updateOperationalStatus('equipment-a', 'gym-a', 'owner', 'MAINTENANCE');
  assert.equal(audits, 1, 'replay must not create a new status event');
});
