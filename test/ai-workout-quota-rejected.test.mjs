import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { AiMonthlyQuotaService }=require('../dist/src/modules/ai/runtime/ai-monthly-quota.service.js');
const { AiProviderExecutionService }=require('../dist/src/modules/ai/runtime/ai-provider-execution.service.js');

test('rejected workout candidate releases only the consumed unit of the originating tenant',async()=>{
 const calls=[];
 const prisma={aiMonthlyConsumption:{
   updateMany: async value=>{calls.push(value);return {count:1};},
 }};
 const monthly=new AiMonthlyQuotaService(prisma,{}, {});
 await monthly.releaseRejectedWorkout('gym-a','request-id-001');
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].where,{tenantId:'gym-a',group:'WORKOUT',requestId:'request-id-001',state:'CONSUMED'});
 assert.equal(calls[0].data.state,'RELEASED');
 assert.ok(calls[0].data.finishedAt instanceof Date);
});

test('quota refund is available only via authorized provider execution domain, not by a tenant endpoint',async()=>{
 const observed=[];
 const monthly={releaseRejectedWorkout:async (tenant,request)=>observed.push({tenant,request})};
 const provider=new AiProviderExecutionService({},{},{},{},monthly);
 await provider.releaseRejectedWorkout('gym-a','request-002');
 assert.deepEqual(observed,[{tenant:'gym-a',request:'request-002'}]);
});
