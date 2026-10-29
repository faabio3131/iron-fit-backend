import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ManagerAlertSourceScanService } = require('../dist/src/modules/manager-alerts/manager-alert-source-scan.service.js');

test('scan derives tenants from committed facts and excludes settled or non-review records', async () => {
  const calls = [];
  const queries = [];
  const now = new Date('2026-10-29T12:00:00Z');
  const due = new Date('2026-10-28T12:00:00Z');
  const prisma = {
    charge: { findMany: async (q) => { queries.push(q); return [{ id: 'c1', gymId: 'gym-a', dueDate: due }]; } },
    workout: { findMany: async (q) => { queries.push(q); return [
      { id: 'w1', createdByAI: true, createdAt: due, student: { gymId: 'gym-b' } },
      { id: 'w2', createdByAI: false, createdAt: due, student: { gymId: 'gym-c' } },
    ]; } },
  };
  const producers = Object.fromEntries(['overdueStudentCharge', 'assessmentOrWorkoutPending', 'humanApprovalPending'].map((name) => [name, async (event) => calls.push({ name, ...event })]));
  const scan = new ManagerAlertSourceScanService(prisma, producers);
  assert.deepEqual(await scan.scanDue(50, now), { charges: 1, workouts: 2 });
  assert.deepEqual(queries[0].where, { status: { in: ['PENDING', 'EXPIRED'] }, paidAt: null, dueDate: { lt: now } });
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
    charge: { findMany: async (q) => { queries.push(q); return q.where.id ? [] : [{ id: 'c1', gymId: 'gym-a', dueDate: new Date() }]; } },
    workout: { findMany: async () => [] },
  };
  const scan = new ManagerAlertSourceScanService(prisma, {
    overdueStudentCharge: async () => { if (fail) throw new Error('database unavailable'); },
  });
  await assert.rejects(scan.scanDue(1), /database unavailable/);
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
