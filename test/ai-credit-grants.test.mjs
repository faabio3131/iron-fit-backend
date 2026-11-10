import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AiMonthlyQuotaService } = require('../dist/src/modules/ai/runtime/ai-monthly-quota.service.js');

const start = new Date('2026-11-01T00:00:00.000Z');
const end = new Date('2026-12-01T00:00:00.000Z');
const gym = '00d4727a-03d4-4d5a-915f-b2a3e45f6dc0';
const paidInvoice = '328ec91f-e575-45e6-83db-9956a3b4e5ff';
function harness(){
 const grants = [];
 const audit = [];
 const tx = {
  aiCreditGrant: {
    findUnique: async ({where}) => grants.find(g => g.sourceInvoiceId === where.sourceInvoiceId) ?? null,
    aggregate: async ({where}) => ({
      _sum: {units: grants.filter(g => g.tenantId === where.tenantId && g.group === where.group &&
        g.periodStart.getTime() === where.periodStart.getTime() && g.periodEnd.getTime() === where.periodEnd.getTime() &&
        g.revokedAt === null).reduce((sum,g)=>sum+g.units,0)},
    }),
    create: async ({data}) => {const grant={id:'grant-'+(grants.length+1),...data,revokedAt:null};grants.push(grant);return grant;},
    updateMany: async ({where,data}) => {const grant=grants.find(g=>g.id===where.id&&g.revokedAt===null);if(!grant)return {count:0};grant.revokedAt=data.revokedAt;return {count:1};},
  },
 };
 const prisma = {
  ...tx,
  $transaction: async (callback, options) => {
    assert.equal(options.isolationLevel,'Serializable');
    return callback(tx);
  },
 };
 const svc = new AiMonthlyQuotaService(prisma,{}, {record: async (event)=>{audit.push(event);}});
 svc.usage = async () => ({ group:'WORKOUT',periodStart:start,periodEnd:end,allowance:50,used:0,remaining:50 });
 return {svc,grants,audit};
}
test('FM Command only: rejects forged unpaid, unknown and unlimited packs', async()=>{
 const {svc,grants}=harness();
 for(const payload of [
  {tenantId:gym,sourceInvoiceId:paidInvoice,packageCode:'IRON_AI_WORKOUT_100',paymentStatus:'PENDING'},
  {tenantId:gym,sourceInvoiceId:paidInvoice,packageCode:'IRON_AI_WORKOUT_UNLIMITED',paymentStatus:'PAID'},
  {tenantId:'',sourceInvoiceId:paidInvoice,packageCode:'IRON_AI_WORKOUT_100',paymentStatus:'PAID'},
 ]){
  await assert.rejects(()=>svc.grantPaidWorkoutPack(payload));
 }
 assert.equal(grants.length,0);
});
test('verified paid pack is idempotent, scoped and audit recorded', async()=>{
 const {svc,grants,audit}=harness();
 const input={tenantId:gym,sourceInvoiceId:paidInvoice,packageCode:'IRON_AI_WORKOUT_100',paymentStatus:'PAID'};
 const first=await svc.grantPaidWorkoutPack(input);
 assert.equal(first.idempotent,false);assert.equal(first.units,100);
 const replay=await svc.grantPaidWorkoutPack(input);
 assert.equal(replay.idempotent,true);
 assert.equal(grants.length,1);assert.equal(audit.length,1);
 await assert.rejects(()=>svc.grantPaidWorkoutPack({...input,tenantId:'other-gym'}));
 await assert.rejects(()=>svc.grantPaidWorkoutPack({...input,packageCode:'IRON_AI_WORKOUT_300'}));
});
test('refund revokes exact tenant grant; retry is no-op and unknown refund is safe', async()=>{
 const {svc,grants,audit}=harness();
 const missing=await svc.revokePaidWorkoutPack({tenantId:gym,sourceInvoiceId:paidInvoice});
 assert.deepEqual(missing,{idempotent:true,revoked:0});
 await svc.grantPaidWorkoutPack({tenantId:gym,sourceInvoiceId:paidInvoice,packageCode:'IRON_AI_WORKOUT_100',paymentStatus:'PAID'});
 await assert.rejects(()=>svc.revokePaidWorkoutPack({tenantId:'other-gym',sourceInvoiceId:paidInvoice}));
 const revoked=await svc.revokePaidWorkoutPack({tenantId:gym,sourceInvoiceId:paidInvoice});
 assert.equal(revoked.revoked,1);
 assert.ok(grants[0].revokedAt instanceof Date);
 assert.equal((await svc.revokePaidWorkoutPack({tenantId:gym,sourceInvoiceId:paidInvoice})).revoked,0);
 assert.equal(audit.length,2);
 await assert.rejects(()=>svc.grantPaidWorkoutPack({tenantId:gym,sourceInvoiceId:paidInvoice,packageCode:'IRON_AI_WORKOUT_100',paymentStatus:'PAID'}));
});
test('settled finite packs cannot be silently denied after money is paid', async()=>{
 const {svc,grants}=harness();
 grants.push({id:'existing',tenantId:gym,group:'WORKOUT',periodStart:start,periodEnd:end,revokedAt:null,units:9900,sourceInvoiceId:'existing'});
 const confirmation=await svc.grantPaidWorkoutPack({
  tenantId:gym,sourceInvoiceId:paidInvoice,packageCode:'IRON_AI_WORKOUT_300',paymentStatus:'PAID'
 });
 assert.equal(confirmation.units,300);
 assert.equal(grants.length,2);
});
