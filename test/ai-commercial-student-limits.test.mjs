import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {StudentsService}=require('../dist/src/modules/students/students.service.js');

function harness(code, entitlement) {
  const queries=[];
  const prisma={
    tenantProductSubscription:{
      findFirst:async query=>{queries.push(query);return {
        id:'sub-1',planVersion:{productPlan:{code}},
      };},
    },
    commercialTrialProvisioning:{findFirst:async()=>null},
  };
  const entitlements={resolveFeature:async(gym,key)=>{
    assert.equal(gym,'gym-one');
    assert.equal(key,'commercial.students_max');
    return entitlement;
  }};
  return {service:new StudentsService(prisma,{},entitlements),queries};
}

test('commercial START and ENTERPRISE student caps come from canonical plan entitlement',async()=>{
 for(const [code,max] of [['IRON_START',100],['IRON_GROWTH',300],['IRON_SCALE',700],['IRON_ENTERPRISE',1500]]) {
  const {service}=harness(code,{kind:'LIMIT',source:'PLAN_ENTITLEMENT',value:max});
  assert.deepEqual(await service.activeStudentLimit('gym-one'),{max,isTrial:false});
 }
});

test('new four-tier student enrollment fails closed on missing or noncanonical cap',async()=>{
 for(const entitlement of [
  {kind:'LIMIT',source:'FAIL_CLOSED_DEFAULT',value:0},
  {kind:'LIMIT',source:'TENANT_CONFIGURATION',value:1500},
  {kind:'FEATURE',source:'PLAN_ENTITLEMENT',value:true},
  {kind:'LIMIT',source:'PLAN_ENTITLEMENT',value:null},
 ]) {
  const {service}=harness('IRON_ENTERPRISE',entitlement);
  await assert.rejects(()=>service.activeStudentLimit('gym-one'),/Limite de alunos do plano nao configurado/);
 }
});

test('historical IRON_V1 subscriptions are not assigned a new paid-student cap',async()=>{
 const {service,queries}=harness('IRON_V1',{});
 assert.equal(await service.activeStudentLimit('gym-one'),null);
 assert.equal(queries.length,1);
});

test('enrollment checks commercial active tenant, not a user-supplied plan name',async()=>{
 const {service,queries}=harness('IRON_START',{kind:'LIMIT',source:'PLAN_ENTITLEMENT',value:100});
 await service.activeStudentLimit('gym-one');
 assert.equal(queries[0].where.gymId,'gym-one');
 assert.equal(queries[0].where.status,'ACTIVE');
 assert.deepEqual(queries[0].where.OR,[{effectiveUntil:null},{effectiveUntil:{gt:queries[0].where.effectiveFrom.lte}}]);
});
