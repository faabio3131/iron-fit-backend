import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { managerAlertQuietUntil } = require('../dist/src/modules/manager-alerts/manager-alert-quiet-hours.js');
const { ManagerAlertDispatchService } = require('../dist/src/modules/manager-alerts/manager-alert-dispatch.service.js');

test('quiet hours follow local overnight windows and DST without delaying the inbox', () => {
  const pref = { quietHoursStart: '22:00', quietHoursEnd: '08:00', timezone: 'America/Sao_Paulo' };
  assert.equal(managerAlertQuietUntil(new Date('2026-10-29T02:30:00Z'), pref).toISOString(), '2026-10-29T11:00:00.000Z');
  assert.equal(managerAlertQuietUntil(new Date('2026-10-29T15:30:00Z'), pref), null);
  assert.equal(managerAlertQuietUntil(new Date('2026-03-08T06:30:00Z'), { quietHoursStart: '22:00', quietHoursEnd: '04:00', timezone: 'America/New_York' }).toISOString(), '2026-03-08T08:00:00.000Z');
});

function fixture({ live = true, optedIn = true, quiet = false } = {}) {
  const changes = [];
  let sent = 0;
  const row = {
    id: 'delivery', alertId: 'alert', channel: 'EMAIL', attemptCount: 1,
    alert: { gymId: 'gym', category: 'STUDENT_BILLING', severity: 'WARNING', status: 'OPEN' },
    recipient: { alertId: 'alert', userId: 'user', user: { email: 'invalid@example.invalid' } },
  };
  const prisma = {
    managerAlertDelivery: {
      updateMany: async (change) => { changes.push(change); if (change.data.leaseOwner) row.leaseOwner = change.data.leaseOwner; return { count: 1 }; },
      findUnique: async () => row,
    },
    managerAlert: { findFirst: async (q) => { assert.ok(q.where.AND[0].OR.length === 2); return live ? { id: 'alert' } : null; } },
    managerAlertPolicy: { findUnique: async () => ({ emailAllowed: true, minimumSeverity: 'INFO' }) },
    managerAlertPreference: { findUnique: async () => ({ emailEnabled: optedIn, minimumSeverity: 'INFO', timezone: 'UTC', quietHoursStart: quiet ? '00:00' : null, quietHoursEnd: quiet ? '23:59' : null }) },
  };
  const service = new ManagerAlertDispatchService(prisma, {}, {}, {}, {}, {}, { record: async () => {} });
  service.sendEmail = async () => { sent++; return { providerCode: 'synthetic', providerMessageRef: 'synthetic' }; };
  return { service, changes, sent: () => sent };
}

test('revoked authority or opt-out skips queued external delivery before any adapter call', async () => {
  for (const options of [{ live: false }, { optedIn: false }]) {
    const { service, changes, sent } = fixture(options);
    const result = await service.dispatchOne('delivery');
    assert.equal(result.reason, 'DELIVERY_AUTHORITY_OR_PREFERENCE_REVOKED');
    assert.equal(sent(), 0);
    assert.equal(changes.at(-1).data.status, 'SKIPPED');
    assert.deepEqual(changes.at(-1).data.attemptCount, { decrement: 1 });
  }
});

test('quiet hours defer rather than spend provider retry budget', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-29T12:00:00Z') });
  const { service, changes, sent } = fixture({ quiet: true });
  await service.dispatchOne('delivery');
  assert.equal(sent(), 0);
  assert.equal(changes.at(-1).data.status, 'DEFERRED');
  assert.equal(changes.at(-1).data.nextAttemptAt.toISOString(), '2026-10-29T23:59:00.000Z');
});

test('expired sends are recovered or dead-lettered before polling new work', async () => {
  const changes = [];
  const service = new ManagerAlertDispatchService({ managerAlertDelivery: {
    updateMany: async (query) => { changes.push(query); return { count: 1 }; },
    findMany: async () => [],
  } }, {}, {}, {}, {}, {}, {});
  await service.dispatchDue();
  assert.deepEqual(changes.map((c) => c.data.status), ['FAILED', 'DEAD_LETTER']);
  assert.ok(changes.every((c) => c.where.status === 'SENDING' && c.where.OR.some((clause) => clause.leaseUntil?.lt instanceof Date)));
});
