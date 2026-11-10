import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixtureCnpj } from './fixture-cnpj.mjs';
import { BASE, request } from '../scripts/b6-e2e-lib.mjs';

const url=BASE+'/control-plane/fmcc';
const tiers={
  IRON_START: { students:100,workout:50,advisory:100 },
  IRON_GROWTH: { students:300,workout:200,advisory:400 },
  IRON_SCALE: { students:700,workout:500,advisory:1000 },
  IRON_ENTERPRISE: { students:1500,workout:750,advisory:2500 },
};
async function call(path,{method='GET',body,key,secret=process.env.FMCC_IRON_CONTROL_PLANE_TOKEN}={}) {
  const response=await fetch(url+path,{method,headers:{
    'authorization':'Bearer '+(secret??''),
    'x-correlation-id':randomUUID(),
    ...(key?{'idempotency-key':key}:{}),
    ...(body?{'content-type':'application/json'}:{}),
  },...(body?{body:JSON.stringify(body)}:{})});
  const raw=await response.text();
  return {status:response.status,body:raw?JSON.parse(raw):null};
}

test('actual NestJS+PostgreSQL IRON exposes four immutable canonical tiers without a Cakto purchase',async()=>{
  const health=await call('/health');
  assert.equal(health.status,200);
  assert.equal(health.body.billing_authority,'FM_COMMAND');
  assert.equal((await call('/plan-versions',{secret:'wrong'})).status,401);
  const catalog=await call('/plan-versions');
  assert.equal(catalog.status,200);
  assert.equal(catalog.body.source_authority,'IRON_PRODUCT_PLAN_VERSION');
  const versions={};
  for(const code of Object.keys(tiers)){
    const rows=catalog.body.plans.filter(x=>x.plan_code===code);
    assert.equal(rows.length,1,'exactly one published version: '+code);
    assert.ok(rows[0].version>=1);
    versions[code]=rows[0].version;
  }
  const original=catalog.body.plans.filter(x=>x.plan_code==='IRON_V1');
  assert.ok(original.some(x=>x.version===1),'legacy published V1 remains immutable');
  const suffix=randomUUID().slice(0,8);
  const owner=(await request('/commercial/trial/start',{method:'POST',expected:201,body:{
    requestId:randomUUID(),email:'quota-'+suffix+'@example.com',
    password:process.env.B6_OWNER_PASSWORD,name:'QA Plan OWNER',
    gymName:'QA Plan Gym '+suffix,cnpj:fixtureCnpj(),timezone:'America/Sao_Paulo',
  }})).payload;
  assert.ok(owner.gymId&&owner.subscriptionId);
  const before=await call('/snapshot');
  assert.equal(before.status,200);
  const historical=before.body.subscriptions.find(x=>x.external_id===owner.subscriptionId);
  assert.ok(historical);
  assert.ok(historical.plan_code.includes('TRIAL'));
  const command={
    action:'subscription.plan.transition',gymId:owner.gymId,
    expectedSubscriptionId:owner.subscriptionId,
    commercialStatus:'upgrade',planCode:'IRON_START',
    planVersion:versions.IRON_START,transitionKind:'UPGRADE',
    reason:'isolated-ci-manual-licensed-transition-without-payment',
  };
  const key='qa-four-tier-license-'+randomUUID();
  const first=await call('/subscription/commands',{method:'POST',body:command,key});
  assert.equal(first.status,201,JSON.stringify(first.body));
  assert.equal(first.body.idempotent,false);
  assert.equal(first.body.result.subscription.planVersion.productPlan.code,'IRON_START');
  const licensedId=first.body.result.subscription.id;
  assert.ok(licensedId&&licensedId!==owner.subscriptionId);
  const replay=await call('/subscription/commands',{method:'POST',body:command,key});
  assert.equal(replay.status,201);
  assert.equal(replay.body.idempotent,true);
  assert.equal((await call('/subscription/commands',{method:'POST',key,body:{
    ...command,planCode:'IRON_ENTERPRISE',
  }})).status,409);
  assert.equal((await call('/subscription/commands',{method:'POST',
    key:'forged-'+randomUUID(),body:{...command,gymId:randomUUID()},
  })).status,404);

  const snapshot=await call('/snapshot');
  const legacy=snapshot.body.subscriptions.find(s=>s.external_id===owner.subscriptionId);
  const paid=snapshot.body.subscriptions.find(s=>s.external_id===licensedId);
  assert.equal(legacy.status,'CANCELED');
  assert.equal(legacy.plan_code,historical.plan_code);
  assert.equal(legacy.plan_version,historical.plan_version);
  assert.equal(paid.status,'ACTIVE');
  assert.equal(paid.plan_code,'IRON_START');
  const entitlements=snapshot.body.entitlements.filter(e=>e.subscription_id===licensedId);
  for(const [key,amount] of Object.entries({
    'commercial.students_max':100,
    'ai.workout_monthly_max':50,
    'ai.advisory_monthly_max':100,
  })){
    assert.equal(entitlements.find(e=>e.feature_key===key)?.limit_value,amount,key);
  }
  const statusPayload={
    action:'subscription.status.sync',gymId:owner.gymId,
    expectedSubscriptionId:licensedId,commercialStatus:'suspended',
    entitlementStatus:'SUSPENDED',reason:'isolated-ci-reconcile-license',
  };
  const held=await call('/subscription/commands',{method:'POST',body:statusPayload,key:'hold-'+randomUUID()});
  assert.equal(held.status,201);
  assert.equal(held.body.result.entitlementStatus,'SUSPENDED');
  const restored=await call('/subscription/commands',{method:'POST',body:{
    ...statusPayload,commercialStatus:'active',entitlementStatus:'ACTIVE',
  },key:'resume-'+randomUUID()});
  assert.equal(restored.status,201);
  assert.equal(restored.body.result.entitlementStatus,'ACTIVE');
  // Exercise actual S2S delivery for ALL four published tiers. A successful
  // catalog GET alone does not prove the license can be provisioned correctly.
  let previousSubscriptionId=licensedId;
  let previousCode='IRON_START';
  const delivered=['IRON_START'];
  for(const code of ['IRON_GROWTH','IRON_SCALE','IRON_ENTERPRISE']){
    const next=await call('/subscription/commands',{method:'POST',
      key:'qa-four-tier-transition-'+randomUUID(),
      body:{
        action:'subscription.plan.transition',
        gymId:owner.gymId,expectedSubscriptionId:previousSubscriptionId,
        commercialStatus:'upgrade',planCode:code,planVersion:versions[code],
        transitionKind:'UPGRADE',reason:'isolated-ci-internal-no-real-payment',
      },
    });
    assert.equal(next.status,201,JSON.stringify(next.body));
    assert.equal(next.body.result.subscription.planVersion.productPlan.code,code);
    const id=next.body.result.subscription.id;
    assert.ok(id!==previousSubscriptionId);
    const current=await call('/snapshot');
    const prior=current.body.subscriptions.find(x=>x.external_id===previousSubscriptionId);
    const active=current.body.subscriptions.find(x=>x.external_id===id);
    assert.equal(prior.status,'CANCELED');
    assert.equal(prior.plan_code,previousCode);
    assert.equal(active.status,'ACTIVE');
    assert.equal(active.plan_code,code);
    assert.equal(active.plan_version,versions[code]);
    const rights=current.body.entitlements.filter(x=>x.subscription_id===id);
    for(const [key,max] of Object.entries({
      'commercial.students_max':tiers[code].students,
      'ai.workout_monthly_max':tiers[code].workout,
      'ai.advisory_monthly_max':tiers[code].advisory,
    })){
      assert.equal(rights.find(x=>x.feature_key===key)?.limit_value,max,code+':'+key);
    }
    delivered.push(code);
    previousCode=code;
    previousSubscriptionId=id;
  }
  const lastSnapshot=await call('/snapshot');
  const unmodifiedLegacy=lastSnapshot.body.subscriptions.find(x=>x.external_id===owner.subscriptionId);
  assert.equal(unmodifiedLegacy.plan_code,historical.plan_code);
  assert.equal(unmodifiedLegacy.plan_version,historical.plan_version);
  assert.equal(unmodifiedLegacy.status,'CANCELED');
  console.log(JSON.stringify({event:'iron_four_tier_real_backend_contract_pass',
    tiers:Object.keys(versions).length,licensesDelivered:delivered,
    legacySubscriptionPreserved:true,realPostgresql:true,realNestHttp:true,
    verifiedS2S:true,duplicatesBlocked:true,tenantSpoofingBlocked:true,
    externalCaktoUsed:false}));
},{timeout:120000});
