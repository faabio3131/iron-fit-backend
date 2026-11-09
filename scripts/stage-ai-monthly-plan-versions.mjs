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
  for(const tier of candidate.tiers) {
    if(!/^IRON_[A-Z_]{2,60}$/.test(tier.code) || planPolicy[tier.code] ||
      !Number.isSafeInteger(tier.workoutAiMonthlyMax) || tier.workoutAiMonthlyMax < 0 ||
      !Number.isSafeInteger(tier.advisoryAiMonthlyMax) || tier.advisoryAiMonthlyMax < 0)
      throw new Error('AI_QUOTA_PLAN_POLICY_INVALID');
    planPolicy[tier.code]={workout:tier.workoutAiMonthlyMax,advisory:tier.advisoryAiMonthlyMax};
  }
  return planPolicy;
}
export function desiredEntitlements(source, allowance) {
  if (!Array.isArray(source) || !allowance) throw new Error('AI_QUOTA_SOURCE_INVALID');
  const prior=new Map(source.map(entry=>[entry.featureKey,entry]));
  // Absence of AI features cannot be interpreted as authorization to introduce them.
  const workout=prior.get('ai.workout_generation')?.featureEnabled === true ? allowance.workout : 0;
  const advisory=prior.get('ai.content_recommendation')?.featureEnabled === true ? allowance.advisory : 0;
  const output=source.filter(entry=>![LIMIT_WORKOUT,LIMIT_ADVISORY].includes(entry.featureKey))
    .map(entry=>({
      featureKey:entry.featureKey,
      ...(entry.kind==='FEATURE'?{featureEnabled:entry.featureEnabled}:{}),
      ...(entry.kind==='LIMIT'?{limitValue:entry.limitValue}:{}),
      ...(entry.kind==='POLICY'?{policyValues:entry.policyValues}:{}),
    }));
  output.push({featureKey:LIMIT_WORKOUT,limitValue:workout});
  output.push({featureKey:LIMIT_ADVISORY,limitValue:advisory});
  return output;
}
function matchesLimits(version,policy) {
  const wanted=desiredEntitlements(version.entitlements,policy);
  return [LIMIT_WORKOUT,LIMIT_ADVISORY].every(key=>{
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
    const actor=process.env.IRON_AI_QUOTA_ACTOR_USER_ID;
    if(apply) {
      const role=await prisma.userRole.findFirst({where:{
        userId:actor,active:true,gymId:null,role:{name:'SUPER_ADMIN'},user:{active:true},
      },select:{id:true}});
      if(!role)throw new Error('AI_QUOTA_SUPER_ADMIN_REQUIRED');
      for(const key of [LIMIT_WORKOUT,LIMIT_ADVISORY]) {
        const definition=await prisma.productCapabilityDefinition.findUnique({where:{key}});
        if (!definition || definition.kind!=='LIMIT' || definition.status!=='ACTIVE')
          throw new Error('AI_QUOTA_CANONICAL_LIMIT_NOT_REGISTERED');
      }
    }
    const rows=await prisma.productPlan.findMany({
      where:{code:{in:Object.keys(policies)}},
      include:{versions:{orderBy:{version:'desc'},include:{entitlements:true}}},
      orderBy:{code:'asc'},
    });
    const report=[];
    for(const plan of rows) {
      const original=plan.versions.find(version=>version.status==='PUBLISHED');
      if(!original)continue; // Four-tier candidates are not published by this script.
      const quota=policies[plan.code];
      const currentIsCorrect=matchesLimits(original,quota);
      const proposedVersion=plan.versions[0].version+1;
      if(currentIsCorrect) {
        report.push({plan:plan.code,sourceVersion:original.version,status:'CURRENT_ALREADY_COMPLIANT'});
        continue;
      }
      if(plan.versions.some(version=>version.status==='DRAFT'))
        throw new Error('AI_QUOTA_EXISTING_DRAFT_REQUIRES_RECONCILIATION:'+plan.code);
      report.push({plan:plan.code,sourceVersion:original.version,proposedVersion,
        status:apply?'PUBLISH_NEW_VERSION':'WOULD_PUBLISH_NEW_VERSION',
        requiresFmCommandSubscriptionTransition:true});
      if(!apply)continue;
      const revision=await service.createVersion(plan.id,{version:proposedVersion},actor);
      if(revision.status!=='DRAFT')throw new Error('AI_QUOTA_VERSION_NOT_DRAFT');
      for(const entitlement of desiredEntitlements(original.entitlements,quota)){
        await service.setEntitlement(plan.id,proposedVersion,entitlement,actor);
      }
      await service.publishVersion(plan.id,proposedVersion,actor);
    }
    console.log(JSON.stringify({applied:apply,planVersionReadiness:report,
      authority:'IRON_PRODUCT_ENTITLEMENTS',subscriptionTransitionsApplied:0},null,2));
  } finally {await app.close();}
}

if(process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g,'/')))
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
