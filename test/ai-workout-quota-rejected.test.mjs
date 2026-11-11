import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { AiMonthlyQuotaService }=require('../dist/src/modules/ai/runtime/ai-monthly-quota.service.js');
const { AiProviderExecutionService }=require('../dist/src/modules/ai/runtime/ai-provider-execution.service.js');
const { AiWorkoutCandidateService }=require('../dist/src/modules/ai/ai-workout-candidate.service.js');

const january=new Date('2026-01-15T00:00:00.000Z');
const february=new Date('2026-02-15T00:00:00.000Z');

test('rejected workout releases only the consumed unit of tenant, request and original billing cycle',async()=>{
 const calls=[];
 const prisma={aiMonthlyConsumption:{
   updateMany: async value=>{calls.push(value);return {count:1};},
 }};
 const monthly=new AiMonthlyQuotaService(prisma,{}, {});
 await monthly.releaseRejectedWorkout('gym-a','request-id-001',january);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].where,{
   tenantId:'gym-a',group:'WORKOUT',requestId:'request-id-001',periodStart:january,state:'CONSUMED'
 });
 assert.equal(calls[0].data.state,'RELEASED');
 assert.ok(calls[0].data.finishedAt instanceof Date);
});

test('same request ID reused in another month cannot release past or other-tenant credits',async()=>{
 const rows=[
   {tenantId:'gym-a',group:'WORKOUT',requestId:'shared-id',periodStart:january,state:'CONSUMED'},
   {tenantId:'gym-a',group:'WORKOUT',requestId:'shared-id',periodStart:february,state:'CONSUMED'},
   {tenantId:'gym-b',group:'WORKOUT',requestId:'shared-id',periodStart:february,state:'CONSUMED'},
   {tenantId:'gym-a',group:'ADVISORY',requestId:'shared-id',periodStart:february,state:'CONSUMED'},
   {tenantId:'gym-a',group:'WORKOUT',requestId:'different-id',periodStart:february,state:'CONSUMED'},
 ];
 const prisma={aiMonthlyConsumption:{updateMany:async ({where,data})=>{
   let count=0;
   for(const row of rows){
     if(row.tenantId===where.tenantId && row.group===where.group
        && row.requestId===where.requestId && row.periodStart.getTime()===where.periodStart.getTime()
        && row.state===where.state){row.state=data.state;count++;}
   }
   return {count};
 }}};
 const monthly=new AiMonthlyQuotaService(prisma,{}, {});
 await monthly.releaseRejectedWorkout('gym-a','shared-id',february);
 assert.deepEqual(rows.map(row=>row.state),['CONSUMED','RELEASED','CONSUMED','CONSUMED','CONSUMED']);
 await monthly.releaseRejectedWorkout('gym-a','shared-id',february);
 assert.deepEqual(rows.map(row=>row.state),['CONSUMED','RELEASED','CONSUMED','CONSUMED','CONSUMED']);
});

test('missing or invalid reservation period fails closed without touching any consumption row',async()=>{
 const calls=[];
 const monthly=new AiMonthlyQuotaService({aiMonthlyConsumption:{
   updateMany:async args=>{calls.push(args);return {count:1};},
 }}, {}, {});
 await monthly.releaseRejectedWorkout('gym-a','shared-id',undefined);
 await monthly.releaseRejectedWorkout('gym-a','shared-id',new Date('invalid'));
 await monthly.releaseRejectedWorkout('','shared-id',january);
 await monthly.releaseRejectedWorkout('gym-a','',january);
 assert.equal(calls.length,0);
});

test('provider execution returns the period of its original DB reservation, not current wall clock',async()=>{
 const calls=[];
 const monthly={
   reserve:async()=>({allowed:true,code:'AI_QUOTA_RESERVED',periodStart:january}),
   finalize:async (...args)=>{calls.push(['finalize',...args]);},
   releaseRejectedWorkout:async (...args)=>{calls.push(['release',...args]);},
 };
 const provider=new AiProviderExecutionService({},{},{},{},monthly);
 provider.executeWithReservedQuota=async()=>({status:'SUCCEEDED',flags:[],output:{sessions:[]}});
 const response=await provider.execute({
   capability:'WORKOUT_GENERATION',
   context:{tenantId:'gym-a',requestId:'request-002',purpose:'workout_candidate_generation'},
   prompt:{promptKey:'workout.candidate_generation',promptVersion:1},input:{},
 });
 assert.equal(response.quotaPeriodStart,january);
 assert.deepEqual(calls[0],['finalize','gym-a','WORKOUT_GENERATION','request-002',january,true]);
 await provider.releaseRejectedWorkout('gym-a','request-002',response.quotaPeriodStart);
 assert.deepEqual(calls[1],['release','gym-a','request-002',january]);
});

test('both rejected workout branches pass original provider reservation period to the release boundary',async()=>{
 for (const validation of [
   {valid:false,output:null,flags:['AI_VALIDATION_REJECTED'],failureCategory:'INVALID_RESPONSE'},
   {valid:true,output:{sessions:[]},flags:[]},
 ]) {
   const released=[];
   const provider={
     execute:async()=>({status:'SUCCEEDED',output:{sessions:[]},flags:[],quotaPeriodStart:january}),
     releaseRejectedWorkout:async(...args)=>{released.push(args);},
   };
   const service=new AiWorkoutCandidateService(
     {},
     {assertAllowed:async()=>{}},
     {buildWorkoutGenerationContext:async()=>({})},
     {sanitize:value=>value},
     provider,
     {resolve:async()=>({available:true,configuration:{
       providerCode:'null_provider',modelCode:'test-model',scope:'GLOBAL',version:1,
     }})},
     {recordExecution:async()=>({id:'trace-001'})},
     {validateAdvisoryOutput:async()=>validation},
     {createAiCandidate:async()=>{throw new Error('invalid candidate must never be saved');}},
   );
   await assert.rejects(()=>service.generate(
     {id:'trainer-a'},'gym-a',{studentId:'student-a',requestId:'shared-id'}
   ));
   assert.deepEqual(released,[['gym-a','shared-id',january]]);
 }
});
