#!/usr/bin/env node
/**
 * Safe, governed plan-version staging for monthly IRON Intelligence quotas.
 * Defaults to READ ONLY. --apply requires explicit operator flag and SUPER_ADMIN actor.
 * Never changes published entitlements or a live tenant subscription in place.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const { NestFactory }=require('@nestjs/core');
const { AppModule }=require('../dist/src/app.module.js');
const { PrismaService }=require('../dist/src/prisma/prisma.service.js');
const { ProductEntitlementsService }=require('../dist/src/modules/product-entitlements/product-entitlements.service.js');
const { ProductCapabilityCatalogService }=require('../dist/src/modules/product-entitlements/product-capability-catalog.service.js');

const LIMIT_WORKOUT='ai.workout_monthly_max';
const LIMIT_ADVISORY='ai.advisory_monthly_max';
const LEGACY={
  IRON_V1_TRIAL:{workout:10,advisory:20},
  IRON_V1:{workout:50,advisory:100},
};
const apply=process.argv.includes('--apply');

export function readQuotaPolicy(candidate) {
  if (!candidate || candidate.status !== 'CANDIDATE_NOT_PUBLISHED'
    || !candidate.features?.noUnlimitedClaims || !Array.isArray(candidate.tiers)
    || candidate.tiers.length !== 4)
    throw new Error('AI_QUOTA_CANDIDATE_INVALID');
  const planPolicy={...LEGACY};
  const exactCodes=new Set(['IRON_START','IRON_GROWTH','IRON_SCALE','IRON_ENTERPRISE']);
  for(const tier of candidate.tiers) {
    if(!exactCodes.delete(tier.code) || planPolicy[tier.code] ||
      !Number.isSafeInteger(tier.workoutAiMonthlyMax) || tier.workoutAiMonthlyMax < 0 ||
      !Number.isSafeInteger(tier.advisoryAiMonthlyMax) || tier.advisoryAiMonthlyMax < 0 ||
      !Number.isSafeInteger(tier.studentsMax) || tier.studentsMax < 1 ||
      typeof tier.name !== 'string' || tier.name.trim().length < 2)
      throw new Error('AI_QUOTA_PLAN_POLICY_INVALID');
    planPolicy[tier.code]={workout:tier.workoutAiMonthlyMax,advisory:tier.advisoryAiMonthlyMax,students:tier.studentsMax};
  }
  if(exactCodes.size) throw new Error('AI_QUOTA_FOUR_TIER_INCOMPLETE');
  return planPolicy;
}
export function desiredEntitlements(source, allowance) {
  if (!Array.isArray(source) || !allowance) throw new Error('AI_QUOTA_SOURCE_INVALID');
  const prior=new Map(source.map(entry=>[entry.featureKey,entry]));
  // Absence of AI features cannot be interpreted as authorization to introduce them.
  const workout=prior.get('ai.workout_generation')?.featureEnabled === true ? allowance.workout : 0;
  const advisory=prior.get('ai.content_recommendation')?.featureEnabled === true ? allowance.advisory : 0;
  const output=source.filter(entry=>![LIMIT_WORKOUT,LIMIT_ADVISORY,'commercial.students_max',
    ...(allowance.students===undefined?[]:['commercial.trial_students_max'])].includes(entry.featureKey))
    .map(entry=>({
      featureKey:entry.featureKey,
      ...(entry.kind==='FEATURE'?{featureEnabled:entry.featureEnabled}:{}),
      ...(entry.kind==='LIMIT'?{limitValue:entry.limitValue}:{}),
      ...(entry.kind==='POLICY'?{policyValues:entry.policyValues}:{}),
    }));
  output.push({featureKey:LIMIT_WORKOUT,limitValue:workout});
  output.push({featureKey:LIMIT_ADVISORY,limitValue:advisory});
  if(allowance.students!==undefined) output.push({featureKey:'commercial.students_max',limitValue:allowance.students});
  // Historical trial-only capacity cannot accidentally become a paid-tier cap.
  return output;
}
function matchesLimits(version,policy) {
  const wanted=desiredEntitlements(version.entitlements,policy);
  return [LIMIT_WORKOUT,LIMIT_ADVISORY,...(policy.students===undefined?[]:['commercial.students_max'])].every(key=>{
    const actual=version.entitlements.find(row=>row.featureKey===key);
    const expected=wanted.find(row=>row.featureKey===key);
    return actual?.kind==='LIMIT' && actual.limitValue===expected?.limitValue;
  });
}
async function main() {
  const manifest=JSON.parse(await readFile(new URL('../config/commercial/iron-four-tiers-2026.candidate.json',import.meta.url),'utf8'));
  const policies=readQuotaPolicy(manifest);
  if (apply && (process.env.IRON_AI_QUOTA_ROLLOUT_APPROVED!=='YES'
      || !/^[0-9a-f-]{36}$/i.test(process.env.IRON_AI_QUOTA_ACTOR_USER_ID??'')))
    throw new Error('AI_QUOTA_OPERATOR_APPROVAL_REQUIRED');
  const app=await NestFactory.createApplicationContext(AppModule,{logger:false});
  try {
    const prisma=app.get(PrismaService);
    const service=app.get(ProductEntitlementsService);
    const catalog=app.get(ProductCapabilityCatalogService);
    const actor=process.env.IRON_AI_QUOTA_ACTOR_USER_ID;
    if(apply) {
      const role=await prisma.userRole.findFirst({where:{
        userId:actor,active:true,gymId:null,role:{name:'SUPER_ADMIN'},user:{active:true},
      },select:{id:true}});
      if(!role)throw new Error('AI_QUOTA_SUPER_ADMIN_REQUIRED');
      for (const [key,description,domain] of [
        [LIMIT_WORKOUT,'Limite mensal de pedidos de geracao de treino por academia.','AI'],
        [LIMIT_ADVISORY,'Limite mensal de outras acoes de IA por academia.','AI'],
        ['commercial.students_max','Limite maximo de alunos ativos por academia no plano SaaS.','CORE'],
      ]) {
        // Canonical create is audited and strictly idempotent; no ad-hoc SQL catalog writes.
        await catalog.create({ key, kind:'LIMIT', domain, description },actor);
        const definition=await prisma.productCapabilityDefinition.findUnique({where:{key}});
        if (!definition || definition.kind!=='LIMIT' || definition.status!=='ACTIVE')
          throw new Error('AI_QUOTA_CANONICAL_LIMIT_NOT_REGISTERED');
      }
    }
    // The four new tiers must be real canonical plans, not versions of legacy
    // IRON_V1. Historical subscriptions and published versions remain immutable.
    const baseline=await prisma.productPlan.findUnique({
      where:{code:'IRON_V1'},
      include:{versions:{orderBy:{version:'desc'},include:{entitlements:true}}},
    });
    const baseVersion=baseline?.versions.find(version=>version.status==='PUBLISHED');
    if(!baseVersion) throw new Error('AI_QUOTA_LEGACY_PUBLISHED_BASELINE_REQUIRED');
    const tierCodes=manifest.tiers.map(t=>t.code);
    const rows=await prisma.productPlan.findMany({
      where:{code:{in:tierCodes}},
      include:{versions:{orderBy:{version:'desc'},include:{entitlements:true}}},
      orderBy:{code:'asc'},
    });
    const known=new Map(rows.map(plan=>[plan.code,plan]));
    const report=[];
    for(const tier of manifest.tiers) {
      const quota=policies[tier.code];
      const existing=known.get(tier.code);
      // A tier's entitlements are built from the published launch baseline,
      // excluding trial-specific limits. No current customer is transitioned.
      const entitled=desiredEntitlements(baseVersion.entitlements,quota);
      if(existing?.versions.some(version=>version.status==='DRAFT'))
        throw new Error('AI_QUOTA_EXISTING_DRAFT_REQUIRES_RECONCILIATION:'+tier.code);
      const matching=existing?.versions.find(version=>
        version.status==='PUBLISHED' && matchesLimits(version,quota));
      if(matching) {
        report.push({plan:tier.code,version:matching.version,status:'CURRENT_ALREADY_COMPLIANT'});
        continue;
      }
      const version=(existing?.versions[0]?.version??0)+1;
      report.push({plan:tier.code,proposedVersion:version,
        status:apply?'PUBLISH_NEW_CANONICAL_TIER':'WOULD_PUBLISH_NEW_CANONICAL_TIER',
        studentLimit:quota.students,workoutMonthlyLimit:quota.workout,
        advisoryMonthlyLimit:quota.advisory,source:'IRON_V1_PUBLISHED',
        existingSubscriptionsChanged:0});
      if(!apply)continue;
      const plan=existing??await service.createPlan({
        code:tier.code,name:'IRON '+tier.name,
        description:'Plano canonico IRON FIT CORE '+tier.name+' com limites por academia.',
      },actor);
      const revision=await service.createVersion(plan.id,{version},actor);
      if(revision.status!=='DRAFT')throw new Error('AI_QUOTA_VERSION_NOT_DRAFT');
      for(const entitlement of entitled)
        await service.setEntitlement(plan.id,version,entitlement,actor);
      await service.publishVersion(plan.id,version,actor);
    }
    console.log(JSON.stringify({applied:apply,planVersionReadiness:report,
      authority:'IRON_PRODUCT_ENTITLEMENTS',subscriptionTransitionsApplied:0,
      historicalPlanVersionsChanged:0},null,2));
  } finally {await app.close();}
}

if(process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g,'/')))
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
