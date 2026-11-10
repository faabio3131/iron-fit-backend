import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readQuotaPolicy, desiredEntitlements } from '../scripts/stage-ai-monthly-plan-versions.mjs';

test('AI quota rollout preserves four-tier candidate and refuses unlimited limits',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../config/commercial/iron-four-tiers-2026.candidate.json',import.meta.url),'utf8'));
 const policy=readQuotaPolicy(manifest);
 assert.equal(policy.IRON_START.workout,50);
 assert.equal(policy.IRON_GROWTH.workout,200);
 assert.equal(policy.IRON_SCALE.workout,500);
 assert.equal(policy.IRON_ENTERPRISE.workout,750);
 assert.equal(policy.IRON_ENTERPRISE.advisory,2500);
 assert.equal(policy.IRON_START.students,100);
 assert.equal(policy.IRON_GROWTH.students,300);
 assert.equal(policy.IRON_SCALE.students,700);
 assert.equal(policy.IRON_ENTERPRISE.students,1500);
 assert.equal(policy.IRON_V1_TRIAL.workout,10);
 assert.throws(()=>readQuotaPolicy({...manifest,tiers:[...manifest.tiers.slice(0,3),
   {...manifest.tiers[3],workoutAiMonthlyMax:-1}]}));
});

test('AI quota staging copies every existing feature and does not add AI authority absent in source',()=>{
 const prior=[
  {featureKey:'equipment.catalog',kind:'FEATURE',featureEnabled:true},
  {featureKey:'ai.workout_generation',kind:'FEATURE',featureEnabled:false},
  {featureKey:'ai.content_recommendation',kind:'FEATURE',featureEnabled:true},
  {featureKey:'commercial.trial_students_max',kind:'LIMIT',limitValue:15},
 ];
 const next=desiredEntitlements(prior,{workout:50,advisory:100});
 assert.equal(next.find(x=>x.featureKey==='ai.workout_monthly_max')?.limitValue,0);
 assert.equal(next.find(x=>x.featureKey==='ai.advisory_monthly_max')?.limitValue,100);
 assert.equal(next.find(x=>x.featureKey==='commercial.trial_students_max')?.limitValue,15);
 assert.equal(next.find(x=>x.featureKey==='equipment.catalog')?.featureEnabled,true);
 assert.equal(next.find(x=>x.featureKey==='ai.workout_generation')?.featureEnabled,false);
 assert.equal(new Set(next.map(x=>x.featureKey)).size,next.length);
});

test('AI quota staging rejects malformed or published proposal manifest',()=>{
 const manifest=JSON.parse('{"status":"PUBLISHED","features":{"noUnlimitedClaims":true},"tiers":[]}');
 assert.throws(()=>readQuotaPolicy(manifest));
});


test('four-tier rollout must reject forged, duplicate, missing or uncapped commercial tiers', async()=>{
 const original=JSON.parse(await readFile(new URL('../config/commercial/iron-four-tiers-2026.candidate.json',import.meta.url),'utf8'));
 const copy=()=>structuredClone(original);
 let forged=copy();forged.tiers[0].code='IRON_FAKE';
 assert.throws(()=>readQuotaPolicy(forged),/AI_QUOTA_PLAN_POLICY_INVALID|AI_QUOTA_FOUR_TIER_INCOMPLETE/);
 let duplicate=copy();duplicate.tiers[1].code='IRON_START';
 assert.throws(()=>readQuotaPolicy(duplicate),/AI_QUOTA_PLAN_POLICY_INVALID/);
 let missing=copy();missing.tiers.pop();
 assert.throws(()=>readQuotaPolicy(missing),/AI_QUOTA_CANDIDATE_INVALID/);
 let uncapped=copy();uncapped.tiers[0].studentsMax=0;
 assert.throws(()=>readQuotaPolicy(uncapped),/AI_QUOTA_PLAN_POLICY_INVALID/);
});

test('four new plan versions inherit immutable legacy rights, not trial student limit',()=>{
 const base=[
  {featureKey:'ai.workout_generation',kind:'FEATURE',featureEnabled:true},
  {featureKey:'ai.content_recommendation',kind:'FEATURE',featureEnabled:true},
  {featureKey:'commercial.trial_students_max',kind:'LIMIT',limitValue:15},
  {featureKey:'equipment.catalog',kind:'FEATURE',featureEnabled:true},
 ];
 const e=desiredEntitlements(base,{workout:750,advisory:2500,students:1500});
 assert.equal(e.find(x=>x.featureKey==='commercial.students_max').limitValue,1500);
 assert.equal(e.find(x=>x.featureKey==='ai.workout_monthly_max').limitValue,750);
 assert.equal(e.find(x=>x.featureKey==='ai.advisory_monthly_max').limitValue,2500);
 assert.equal(e.find(x=>x.featureKey==='commercial.trial_students_max'),undefined);
 assert.equal(e.find(x=>x.featureKey==='equipment.catalog').featureEnabled,true);
 assert.equal(new Set(e.map(x=>x.featureKey)).size,e.length);
 assert.equal(base.length,4,'baseline remains untouched');
});
