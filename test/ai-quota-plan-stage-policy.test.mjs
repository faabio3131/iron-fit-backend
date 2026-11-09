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
 assert.equal(policy.IRON_ENTERPRISE.workout,1200);
 assert.equal(policy.IRON_ENTERPRISE.advisory,2500);
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
