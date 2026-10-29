import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ManagerAlertCategory, ManagerAlertSeverity, Prisma } = require('@prisma/client');
const { ManagerAlertsService } = require('../dist/src/modules/manager-alerts/manager-alerts.service.js');

const owner = { id: 'owner-a', roles: ['OWNER'], activeGymId: 'gym-a' };

test('manager alert financial ingestion derives OWNER recipients and persists audit atomically', async () => {
  let membershipWhere;
  let createdData;
  const audits = [];
  const tx = {
    userRole: {
      findMany: async ({ where }) => {
        membershipWhere = where;
        return [{ userId: 'owner-a', role: { name: 'OWNER' } }];
      },
    },
    managerAlertPolicy: { findUnique: async () => null },
    managerAlertPreference: { findMany: async () => [] },
    managerAlert: {
      create: async ({ data }) => {
        createdData = data;
        return { id: 'alert-a', ...data, recipients: [{ id: 'recipient-a', userId: 'owner-a' }] };
      },
    },
    managerAlertDelivery: { createMany: async () => assert.fail('delivery must require explicit policy and opt-in') },
  };
  const prisma = { $transaction: async (fn) => fn(tx) };
  const service = new ManagerAlertsService(prisma, { record: async (input, db) => { assert.equal(db, tx); audits.push(input); } });
  const result = await service.ingest({
    gymId: 'gym-a', category: ManagerAlertCategory.STUDENT_BILLING,
    severity: ManagerAlertSeverity.WARNING, eventKey: 'charge.overdue',
    deduplicationKey: 'charge.overdue:1', title: 'Vencida', message: 'Requer análise',
  });
  assert.deepEqual(membershipWhere.role.name.in, ['OWNER']);
  assert.equal(createdData.gymId, 'gym-a');
  assert.equal(result.replayed, false);
  assert.equal(audits[0].action, 'MANAGER_ALERT_CREATED');
});

test('manager alert replay returns canonical row after tenant-scoped unique collision', async () => {
  const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.19.3' });
  let lookup;
  const prisma = {
    $transaction: async () => { throw duplicate; },
    managerAlert: { findUniqueOrThrow: async ({ where }) => { lookup = where; return { id: 'existing' }; } },
  };
  const service = new ManagerAlertsService(prisma, {});
  const result = await service.ingest({
    gymId: 'gym-a', category: ManagerAlertCategory.OPERATIONAL_INCIDENT,
    severity: ManagerAlertSeverity.CRITICAL, eventKey: 'incident',
    deduplicationKey: 'incident:1', title: 'Incidente', message: 'Falha',
  });
  assert.deepEqual(lookup.gymId_deduplicationKey, { gymId: 'gym-a', deduplicationKey: 'incident:1' });
  assert.equal(result.replayed, true);
});

test('manager inbox scopes every list and unread count to tenant plus current recipient', async () => {
  const calls = [];
  const prisma = {
    managerAlert: {
      findMany: ({ where }) => { calls.push(where); return Promise.resolve([]); },
      count: ({ where }) => { calls.push(where); return Promise.resolve(0); },
    },
    managerAlertRecipient: {
      count: ({ where }) => { calls.push(where); return Promise.resolve(0); },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const service = new ManagerAlertsService(prisma, {});
  await service.list(owner, { limit: 30, offset: 0 });
  assert.equal(calls[0].gymId, 'gym-a');
  assert.deepEqual(calls[0].recipients, { some: { userId: 'owner-a' } });
  assert.deepEqual(calls[2], { userId: 'owner-a', readAt: null, alert: { gymId: 'gym-a' } });
});

test('stale manager alert transition fails closed and does not audit success', async () => {
  let audited = 0;
  const recipient = { id: 'recipient-a', readAt: null, alert: { id: 'alert-a', status: 'OPEN' } };
  const tx = {
    managerAlert: { updateMany: async () => ({ count: 0 }), findUniqueOrThrow: async () => assert.fail() },
    managerAlertRecipient: { update: async () => assert.fail() },
  };
  const prisma = {
    managerAlertRecipient: { findFirst: async () => recipient },
    $transaction: async (fn) => fn(tx),
  };
  const service = new ManagerAlertsService(prisma, { record: async () => { audited++; } });
  await assert.rejects(() => service.transition('alert-a', 'ACKNOWLEDGED', owner), (error) => error?.getStatus?.() === 400);
  assert.equal(audited, 0);
});
