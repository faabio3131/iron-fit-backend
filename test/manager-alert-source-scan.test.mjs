import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ManagerAlertSourceScanService } = require('../dist/src/modules/manager-alerts/manager-alert-source-scan.service.js');
const { ManagerAlertDispatchService } = require('../dist/src/modules/manager-alerts/manager-alert-dispatch.service.js');
const emptySources = () => ({ communicationMessage: { findMany: async () => [] }, integrationConnection: { findMany: async () => [] }, accessEvent: { findMany: async () => [] } });
const runtime = { current: () => 'HOMOLOG' };

test('internal scanning runs without external delivery and scan failure cannot block existing outbox', async () => {
  const flags = new Map([['MANAGER_ALERT_SCAN_ENABLED', 'true']]);
  let scanned = 0;
  let dispatched = 0;
  const dispatcher = new ManagerAlertDispatchService({}, { get: (key) => flags.get(key) }, {}, {}, {}, {}, {}, {
    scanDue: async () => { scanned++; throw new Error('must never appear in logs'); },
  }, { scanDue: async () => {} });
  const messages = [];
  dispatcher.logger = { error: (message) => messages.push(message) };
  dispatcher.dispatchDue = async () => { dispatched++; };
  await dispatcher.runCycle();
  assert.equal(scanned, 1);
  assert.equal(dispatched, 0);
  flags.set('MANAGER_ALERT_DISPATCH_ENABLED', 'true');
  await dispatcher.runCycle();
  assert.equal(scanned, 2);
  assert.equal(dispatched, 1);
  assert.deepEqual(messages, ['MANAGER_ALERT_SOURCE_SCAN_FAILED', 'MANAGER_ALERT_SOURCE_SCAN_FAILED']);
  assert.equal(dispatcher.running, false);
});

test('scan derives tenants from committed facts and excludes settled or non-review records', async () => {
  const calls = [];
  const queries = [];
  const now = new Date('2026-10-29T12:00:00Z');
  const due = new Date('2026-10-28T12:00:00Z');
  const prisma = {
    ...emptySources(),
    charge: { findMany: async (q) => { queries.push(q); return [{ id: 'c1', gymId: 'gym-a', dueDate: due }]; } },
    workout: { findMany: async (q) => { queries.push(q); return [
      { id: 'w1', createdByAI: true, createdAt: due, student: { gymId: 'gym-b' } },
      { id: 'w2', createdByAI: false, createdAt: due, student: { gymId: 'gym-c' } },
    ]; } },
  };
  const producers = Object.fromEntries(['overdueStudentCharge', 'assessmentOrWorkoutPending', 'humanApprovalPending'].map((name) => [name, async (event) => calls.push({ name, ...event })]));
  const scan = new ManagerAlertSourceScanService(prisma, producers, runtime);
  assert.deepEqual(await scan.scanDue(50, now), { charges: 1, workouts: 2, messages: 0, integrations: 0, suspiciousAccesses: 0 });
  assert.deepEqual(queries[0].where, { paidAt: null, OR: [{ status: { in: ['PENDING', 'EXPIRED'] }, dueDate: { lt: now } }, { status: 'FAILED' }] });
  assert.equal(queries[1].where.status, 'PENDING_REVIEW');
  assert.equal(calls[0].gymId, 'gym-a');
  assert.equal(calls[0].eventId, `c1:${due.toISOString()}`);
  assert.deepEqual(calls.filter((c) => c.name === 'humanApprovalPending').map((c) => c.gymId), ['gym-b']);
  const original = structuredClone(calls);
  await scan.scanDue(50, now);
  assert.deepEqual(calls.slice(4), original, 'restart/reconciliation must retain stable deduplication inputs');
});

test('bounded scan advances past successful rows and retries failed ingestion without skipping', async () => {
  const queries = [];
  let fail = true;
  const prisma = {
    ...emptySources(),
    charge: { findMany: async (q) => { queries.push(q); return q.where.id ? [] : [{ id: 'c1', gymId: 'gym-a', dueDate: new Date() }]; } },
    workout: { findMany: async () => [] },
  };
  const scan = new ManagerAlertSourceScanService(prisma, {
    overdueStudentCharge: async () => { if (fail) throw new Error('database unavailable'); },
  }, runtime);
  await assert.rejects(scan.scanDue(1), /MANAGER_ALERT_SOURCE_SCAN_FAILED/);
  fail = false;
  await scan.scanDue(1);
  await scan.scanDue(1);
  await scan.scanDue(1);
  assert.equal(queries[0].where.id, undefined);
  assert.equal(queries[1].where.id, undefined);
  assert.deepEqual(queries[2].where.id, { gt: 'c1' });
  assert.equal(queries[3].where.id, undefined, 'full traversal restarts so later changes are discovered');
  assert.ok(queries.every((q) => q.take === 1));
});

test('real communication, integration and security sources preserve provenance and exclude secrets', async () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const queries = {};
  const calls = [];
  const prisma = {
    charge: { findMany: async () => [] }, workout: { findMany: async () => [] },
    communicationMessage: { findMany: async (q) => { queries.message = q; return [{ id: 'm1', gymId: 'a', createdAt: now }]; } },
    integrationConnection: { findMany: async (q) => { queries.integration = q; return [{ id: 'i1', gymId: 'b', updatedAt: now }]; } },
    accessEvent: { findMany: async (q) => { queries.access = q; return [{ id: 'e1', gymId: 'c', occurredAt: now }]; } },
  };
  const producers = Object.fromEntries(['deliveryFailure', 'integrationDegraded', 'suspiciousAccess'].map((key) => [key, async (event) => calls.push({ key, ...event })]));
  const scan = new ManagerAlertSourceScanService(prisma, producers, runtime);
  await scan.scanDue();
  assert.equal(queries.message.where.status, 'FAILED');
  assert.deepEqual(queries.message.where.channel.in, ['EMAIL', 'WHATSAPP']);
  assert.deepEqual(queries.integration.where, { scope: 'TENANT', gymId: { not: null }, environment: 'HOMOLOG', status: 'DEGRADED' });
  assert.deepEqual(queries.access.where, { allowed: false, denialReason: { in: ['Replay detectado', 'Autenticacao do dispositivo invalida'] } });
  assert.deepEqual(calls.map((c) => c.gymId).sort(), ['a', 'b', 'c']);
  assert.equal(calls.find((c) => c.key === 'suspiciousAccess').resourceType, 'AccessEvent');
  for (const q of Object.values(queries)) {
    assert.equal(q.take, 50);
    assert.ok(!('body' in q.select) && !('secretReference' in q.select) && !('denialReason' in q.select));
  }
});

test('one failed source does not suppress independent security events, and failures are sanitized', async () => {
  let received = 0;
  const prisma = {
    ...emptySources(), charge: { findMany: async () => { throw new Error('secret-database-url'); } },
    accessEvent: { findMany: async () => [{ id: 'a', gymId: 'gym', occurredAt: new Date() }] },
  };
  const scan = new ManagerAlertSourceScanService(prisma, { suspiciousAccess: async () => { received++; } }, runtime);
  await assert.rejects(scan.scanDue(), (error) => error.message === 'MANAGER_ALERT_SOURCE_SCAN_FAILED');
  assert.equal(received, 1);
});

test('payment failures without due date reach the financial OWNER-only category', async () => {
  const { ManagerAlertProducersService } = require('../dist/src/modules/manager-alerts/manager-alert-producers.service.js');
  const received = [];
  const producers = new ManagerAlertProducersService({ ingest: async (event) => received.push(event) });
  const prisma = {
    ...emptySources(),
    charge: { findMany: async () => [{ id: 'failed', gymId: 'gym-a', status: 'FAILED', dueDate: null }] },
    workout: { findMany: async () => [] },
  };
  const scan = new ManagerAlertSourceScanService(prisma, producers, runtime);
  await scan.scanDue();
  assert.equal(received.length, 1);
  assert.equal(received[0].category, 'STUDENT_BILLING');
  assert.equal(received[0].resourceType, 'Charge');
  assert.equal(received[0].gymId, 'gym-a');
});
