import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const api = new URL(process.env.B6_API_URL ?? 'http://127.0.0.1:3333/api/v1');
const database = new URL(process.env.DATABASE_URL ?? '');
if (process.env.NODE_ENV !== 'test' || process.env.IRON_RUNTIME_ENV !== 'HOMOLOG' ||
    !['localhost','127.0.0.1'].includes(database.hostname) || database.pathname !== '/iron_ci' ||
    !['localhost','127.0.0.1'].includes(api.hostname)) {
  throw new Error('Refusing legacy-limit fixture outside isolated local IRON CI');
}

const governance = process.env.FMCC_IRON_PLAN_GOVERNANCE_TOKEN;
const billing = process.env.FMCC_IRON_CONTROL_PLANE_TOKEN;
const db = new PrismaClient();

async function call(path, {method='GET', token=governance, body, correlation=randomUUID()} = {}) {
  const response = await fetch(api.href.replace(/\/$/, '') + '/control-plane/fmcc/legacy-limits' + path, {
    method, headers:{authorization:'Bearer '+token,'x-correlation-id':correlation,
      'content-type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}),
  });
  const data = await response.json();
  return {status:response.status,data};
}

test('real PostgreSQL legacy LIMIT review, stale-state rejection, exact transition and audit', async () => {
  assert.ok(governance && governance.length >= 32 && billing && governance !== billing);
  let cleanup;
  try {
    const trials = await db.commercialTrialProvisioning.findMany({
      orderBy:{createdAt:'desc'},take:40, select:{gymId:true,subscriptionId:true},
    });
    let candidate;
    for (const trial of trials) {
      const gym = await db.gym.findUnique({where:{id:trial.gymId},select:{active:true}});
      const sub = await db.tenantProductSubscription.findUnique({
        where:{id:trial.subscriptionId},include:{planVersion:{include:{productPlan:true,entitlements:true}}},
      });
      if (!gym?.active || sub?.status !== 'ACTIVE' || sub.effectiveFrom > new Date() ||
        (sub.effectiveUntil && sub.effectiveUntil <= new Date())) continue;
      for (const ent of sub.planVersion.entitlements) {
        if (ent.kind !== 'LIMIT' || !Number.isInteger(ent.limitValue) || ent.limitValue < 1) continue;
        const capability = await db.productCapabilityDefinition.findUnique({where:{key:ent.featureKey}});
        if (capability?.status !== 'ACTIVE') continue;
        if (await db.tenantProductConfiguration.findUnique({where:{gymId_featureKey:{gymId:trial.gymId,featureKey:ent.featureKey}}})) continue;
        candidate={gymId:trial.gymId,sub,ent}; break;
      }
      if(candidate) break;
    }
    assert.ok(candidate,'disposable trial with a positive plan LIMIT required');
    const {gymId,sub,ent}=candidate;
    const row=await db.tenantProductConfiguration.create({
      data:{gymId,featureKey:ent.featureKey,kind:'LIMIT',limitValue:ent.limitValue-1},
    });
    cleanup=row.id;
    const path='/'+gymId;
    assert.equal((await call(path,{token:billing})).status,401);
    assert.equal((await call('/'+randomUUID())).status,404);
    const read=await call(path);
    assert.equal(read.status,200);
    const review=read.data.limits.find(x=>x.configurationId===row.id);
    assert.equal(review.status,'REVIEW_REQUIRED');
    assert.equal(review.effectiveLimit,ent.limitValue-1);
    assert.equal(review.planLimit,ent.limitValue);
    const body={configurationId:row.id,subscriptionId:sub.id,
      planCode:sub.planVersion.productPlan.code,planVersion:sub.planVersion.version,
      legacyLimit:ent.limitValue-1,planLimit:ent.limitValue,
      confirm:'ALINHAR_AO_LIMITE_DO_PLANO',reason:'Disposable CI legacy limit review'};
    const operation=path+'/'+encodeURIComponent(ent.featureKey)+'/align';
    assert.equal((await call(operation,{method:'POST',body:{...body,planLimit:ent.limitValue+1}})).status,409);
    assert.equal((await call(operation,{method:'POST',token:billing,body})).status,401);
    assert.equal((await call(operation,{method:'POST',body:{...body,confirm:'AUTO'}})).status,400);
    assert.ok(await db.tenantProductConfiguration.findUnique({where:{id:row.id}}));
    const correlation=randomUUID();
    const aligned=await call(operation,{method:'POST',body,correlation});
    assert.equal(aligned.status,201);
    assert.equal(aligned.data.effectiveLimit,ent.limitValue);
    assert.equal(await db.tenantProductConfiguration.findUnique({where:{id:row.id}}),null);
    assert.equal((await call(operation,{method:'POST',body,correlation})).status,409);
    const audit=await db.auditLog.findMany({where:{gymId,entityId:row.id,action:'FM_LEGACY_LIMIT_ALIGNED_TO_PLAN'}});
    assert.equal(audit.length,1);
    assert.equal(audit[0].next.correlationId,correlation);
    assert.equal(audit[0].next.effectiveLimit,ent.limitValue);
    assert.equal((await db.tenantProductSubscription.findUnique({where:{id:sub.id}})).planVersionId,sub.planVersionId);
    console.log(JSON.stringify({event:'iron_fm_legacy_limit_http_pg_certified',review:true,staleDenied:true,billingDenied:true,
      explicitApproval:true,atomicAudit:true,noPlanAssignment:true}));
  } finally {
    if(cleanup) await db.tenantProductConfiguration.deleteMany({where:{id:cleanup}});
    await db.$disconnect();
  }
},{timeout:120000});
