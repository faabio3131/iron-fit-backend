import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { monthlyCycle, AiMonthlyQuotaService } = require('../dist/src/modules/ai/runtime/ai-monthly-quota.service.js');

test('AI monthly billing anniversary clamps month-end and never accumulates unused quotas', () => {
  const anchor = new Date('2026-01-31T15:20:00.000Z');
  assert.equal(monthlyCycle(anchor, new Date('2026-02-28T15:20:01Z')).start.toISOString(), '2026-02-28T15:20:00.000Z');
  assert.equal(monthlyCycle(anchor, new Date('2026-02-28T15:20:01Z')).end.toISOString(), '2026-03-31T15:20:00.000Z');
  assert.equal(monthlyCycle(anchor, new Date('2027-01-30T15:20:01Z')).start.toISOString(), '2026-12-31T15:20:00.000Z');
});

function harness(allowance = 2) {
  const rows = [];
  const subscription = {
    effectiveFrom: new Date('2026-01-17T00:00:00.000Z'),
    saasBillingAgreement: null,
  };
  const count = async ({ where }) => rows.filter((r) =>
    r.tenantId === where.tenantId && r.group === where.group &&
    r.periodStart.getTime() === where.periodStart.getTime() &&
    where.state.in.includes(r.state)).length;
  const tx = {
    aiCreditGrant: {
      findUnique: async ({ where }) => grants.find(g => g.sourceInvoiceId === where.sourceInvoiceId) ?? null,
      aggregate: async ({ where }) => ({ _sum: { units: grants.filter(g =>
        g.tenantId === where.tenantId && g.group === where.group &&
        g.periodStart.getTime() === where.periodStart.getTime() &&
        g.periodEnd.getTime() === where.periodEnd.getTime() && g.revokedAt === null
      ).reduce((sum,g) => sum+g.units, 0) } }),
      create: async ({ data }) => {
        const row = { ...data, id: 'grant-' + (grants.length + 1), revokedAt: null };
        grants.push(row); return row;
      },
      updateMany: async ({ where, data }) => {
        const row = grants.find(g => g.id === where.id && g.revokedAt === null);
        if (!row) return { count: 0 };
        row.revokedAt = data.revokedAt; return { count: 1 };
      },
    },
    aiMonthlyConsumption: {
      count,
      findUnique: async ({ where }) => rows.find(r =>
        r.tenantId === where.tenantId_group_periodStart_requestId.tenantId &&
        r.group === where.tenantId_group_periodStart_requestId.group &&
        r.requestId === where.tenantId_group_periodStart_requestId.requestId &&
        r.periodStart.getTime() === where.tenantId_group_periodStart_requestId.periodStart.getTime()) ?? null,
      create: async ({ data }) => { rows.push({...data}); return data; },
    }
  };
  const grants = [];
  const prisma = {
    tenantProductSubscription: { findFirst: async () => subscription },
    aiCreditGrant: {
      aggregate: async ({ where }) => ({ _sum: { units: grants.filter(g =>
        g.tenantId === where.tenantId && g.group === where.group &&
        g.periodStart.getTime() === where.periodStart.getTime() &&
        g.periodEnd.getTime() === where.periodEnd.getTime() && g.revokedAt === null
      ).reduce((sum,g) => sum+g.units, 0) } }),
    },
    aiMonthlyConsumption: {
      count,
      updateMany: async ({ where, data }) => {
        let updated = 0;
        for (const row of rows) if (row.tenantId === where.tenantId &&
          row.group === where.group && row.requestId === where.requestId &&
          row.periodStart.getTime() === where.periodStart.getTime() && row.state === where.state) {
          row.state = data.state; updated++;
        }
        return { count: updated };
      },
    },
    $transaction: async (cb, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return cb(tx);
    }
  };
  const entitlements = { resolveFeature: async (_, key) => {
    assert.ok(['ai.workout_monthly_max','ai.advisory_monthly_max'].includes(key));
    return { value: allowance };
  }};
  const audits = [];
  return {
    service: new AiMonthlyQuotaService(prisma, entitlements, { record: async record => audits.push(record) }),
    rows, grants, audits,
  };
}

test('annual paid subscriptions still use a monthly quota, not an annual pool', async () => {
  const {service} = harness(20);
  // A yearly period must not turn one month of credits into twelve months of credits.
  const cycle = monthlyCycle(new Date('2026-01-31T00:00:00Z'), new Date('2026-11-09T12:00:00Z'));
  assert.equal(cycle.start.toISOString(), '2026-10-31T00:00:00.000Z');
  assert.equal(cycle.end.toISOString(), '2026-11-30T00:00:00.000Z');
  assert.equal((await service.usage('gym-a','WORKOUT_GENERATION')).allowance,20);
});

test('AI quota reserves once per tenant/request and denies replay and overage', async () => {
  const {service} = harness(2);
  const one = await service.reserve('gym-a', 'WORKOUT_GENERATION', 'first');
  const two = await service.reserve('gym-a', 'WORKOUT_GENERATION', 'second');
  assert.equal(one.allowed, true);
  assert.equal(two.allowed, true);
  assert.deepEqual((await service.reserve('gym-a','WORKOUT_GENERATION','third')).code,'AI_MONTHLY_QUOTA_EXHAUSTED');
  assert.equal((await service.reserve('gym-a','WORKOUT_GENERATION','first')).code,'AI_QUOTA_REQUEST_REPLAY');
  await service.finalize('gym-a','WORKOUT_GENERATION','first',one.periodStart,true);
  await service.finalize('gym-a','WORKOUT_GENERATION','second',two.periodStart,false);
  assert.equal((await service.reserve('gym-a','WORKOUT_GENERATION','fourth')).allowed,true);
  assert.equal((await service.usage('gym-a','WORKOUT_GENERATION')).used,2);
});

test('AI quota is fail-closed without a positive commercial entitlement', async () => {
  const {service} = harness(0);
  assert.equal((await service.reserve('gym-a','WORKOUT_GENERATION','req')).allowed,false);
  assert.equal((await service.usage('gym-a','WORKOUT_GENERATION')).allowance,0);
});

test('AI workouts and advisory quota are independently metered', async () => {
  const {service} = harness(1);
  assert.equal((await service.reserve('gym-a','WORKOUT_GENERATION','one')).allowed,true);
  assert.equal((await service.reserve('gym-a','ADVISORY_CHAT','two')).allowed,true);
  assert.equal((await service.reserve('gym-a','WORKOUT_GENERATION','three')).allowed,false);
});

test('FMCC paid invoice grants one non-rollover pack, idempotently; refund revokes credits', async () => {
  const {service, grants, audits} = harness(50);
  const payload = { tenantId: 'gym-a', sourceInvoiceId: 'fmcc:invoice-123', packageCode: 'IRON_AI_WORKOUT_100', paymentStatus: 'PAID' };
  const created = await service.grantPaidWorkoutPack(payload);
  assert.equal(created.idempotent, false);
  assert.equal(created.units, 100);
  assert.equal((await service.usage('gym-a','WORKOUT_GENERATION')).allowance,150);
  assert.equal((await service.grantPaidWorkoutPack(payload)).idempotent,true);
  assert.equal(grants.length,1);
  assert.equal(audits.length,1);
  await assert.rejects(() => service.grantPaidWorkoutPack({ ...payload, tenantId: 'gym-b' }), /utilizada/);
  const revoked = await service.revokePaidWorkoutPack({ tenantId:'gym-a', sourceInvoiceId:payload.sourceInvoiceId });
  assert.equal(revoked.revoked,1);
  assert.equal(audits.length,2);
  assert.equal((await service.usage('gym-a','WORKOUT_GENERATION')).allowance,50);
  assert.equal((await service.revokePaidWorkoutPack({ tenantId:'gym-a', sourceInvoiceId:payload.sourceInvoiceId })).idempotent,true);
  await assert.rejects(() => service.grantPaidWorkoutPack(payload), /utilizada/);
});

test('FMCC credit import rejects unpaid, unknown and forged package requests', async () => {
  const {service, grants} = harness(50);
  for (const change of [{ paymentStatus:'OPEN' }, { packageCode:'IRON_AI_WORKOUT_UNLIMITED' }, {sourceInvoiceId:'bad'}]) {
    await assert.rejects(() => service.grantPaidWorkoutPack({
      tenantId:'gym-a', sourceInvoiceId:'fmcc:invoice-123', packageCode:'IRON_AI_WORKOUT_100',
      paymentStatus:'PAID', ...change,
    }));
  }
  assert.equal(grants.length,0);
});
