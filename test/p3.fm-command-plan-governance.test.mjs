import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { FmCommandPlanGovernanceGuard } = require('../dist/src/modules/fm-command/fm-command-plan-governance.guard.js');
const { FmCommandPlanGovernanceController } = require('../dist/src/modules/fm-command/fm-command-plan-governance.controller.js');

const originalAdmin = process.env.FMCC_IRON_PLAN_GOVERNANCE_TOKEN;
const originalBilling = process.env.FMCC_IRON_CONTROL_PLANE_TOKEN;
const credential = 'admin-governance-20261118-abcdefghijklmnop';
const billing = 'readback-billing-20261118-abcdefghijklmnop';

function request(token, correlation = 'trace-p3') {
  const headers = { authorization: 'Bearer ' + token, 'x-correlation-id': correlation };
  return { headers };
}
function context(req) {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}
function setup() {
  process.env.FMCC_IRON_PLAN_GOVERNANCE_TOKEN = credential;
  process.env.FMCC_IRON_CONTROL_PLANE_TOKEN = billing;
}
function restore() {
  if (originalAdmin === undefined) delete process.env.FMCC_IRON_PLAN_GOVERNANCE_TOKEN;
  else process.env.FMCC_IRON_PLAN_GOVERNANCE_TOKEN = originalAdmin;
  if (originalBilling === undefined) delete process.env.FMCC_IRON_CONTROL_PLANE_TOKEN;
  else process.env.FMCC_IRON_CONTROL_PLANE_TOKEN = originalBilling;
}

test('governance bearer is distinct from billing token, fails closed and demands correlation', () => {
  setup();
  try {
    const guard = new FmCommandPlanGovernanceGuard();
    const approved = request(credential);
    assert.equal(guard.canActivate(context(approved)), true);
    assert.equal(approved.fmCommandCorrelationId, 'trace-p3');
    assert.throws(() => guard.canActivate(context(request(billing))), /nao autorizada/i);
    assert.throws(() => guard.canActivate(context(request(credential, ''))), /Correlation ID/);
    assert.throws(() => guard.canActivate(context(request(''))), /nao autorizada/i);
    process.env.FMCC_IRON_PLAN_GOVERNANCE_TOKEN = billing;
    assert.throws(() => guard.canActivate(context(request(billing))), /nao configurada/i);
    delete process.env.FMCC_IRON_PLAN_GOVERNANCE_TOKEN;
    assert.throws(() => guard.canActivate(context(request(credential))), /nao configurada/i);
  } finally { restore(); }
});

test('governance reuses the canonical engine and returns only bounded plan data', async () => {
  const calls = [];
  const controller = new FmCommandPlanGovernanceController({
    findPlans: async () => [{ id: 'plan-a', code: 'IRON_A', name: 'IRON A', versions: [
      { version: 2, status: 'DRAFT', entitlements: [
        { featureKey: 'ai.workout_monthly_max', kind: 'LIMIT', featureEnabled: null, limitValue: 100, policyValues: null },
      ] },
    ] }],
    createPlan: async (input) => { calls.push(['plan',input]); return input; },
    createVersion: async (...args) => { calls.push(['version',...args]); return { version: args[1].version }; },
    setEntitlement: async (...args) => { calls.push(['entitlement',...args]); return args[2]; },
    publishVersion: async (...args) => { calls.push(['publish',...args]); return { status: 'PUBLISHED' }; },
    retireVersion: async (...args) => { calls.push(['retire',...args]); return {status:'RETIRED'}; },
  }, {
    listGovernance: async () => [{ key:'ai.workout_monthly_max',kind:'LIMIT',domain:'AI',description:'Limite de treino',status:'ACTIVE',allowedPolicyValues:null }],
  });
  const catalog = await controller.catalog();
  assert.equal(catalog.schema_version, 'iron.fmcc.plan-governance.v1');
  assert.equal(catalog.plans[0].versions[0].entitlements[0].limitValue, 100);
  assert.equal(catalog.capabilities[0].kind, 'LIMIT');
  assert.equal(catalog.plans[0].versions[0].publishedAt, undefined);
  await controller.createPlan({code:'IRON_B',name:'IRON B'});
  await controller.createVersion('plan-id',{version:3});
  await controller.setEntitlement('plan-id',3,{featureKey:'ai.workout_monthly_max',limitValue:100});
  await controller.publishVersion('plan-id',3);
  await controller.retireVersion('plan-id',3);
  assert.deepEqual(calls.map(c=>c[0]),['plan','version','entitlement','publish','retire']);
  assert.deepEqual(calls.at(-1),['retire','plan-id',3,undefined,true]);
});

test('the dedicated endpoint is separate from browser SUPER_ADMIN and tokenless subscriptions', async () => {
  const [source, service, module] = await Promise.all([
    readFile('src/modules/fm-command/fm-command-plan-governance.controller.ts','utf8'),
    readFile('src/modules/product-entitlements/product-entitlements.service.ts','utf8'),
    readFile('src/modules/fm-command/fm-command.module.ts','utf8'),
  ]);
  assert.match(source, /@UseGuards\(FmCommandPlanGovernanceGuard\)/);
  assert.match(source, /ProductEntitlementsService/);
  assert.match(source, /ProductCapabilityCatalogService/);
  assert.doesNotMatch(source, /gymId|activeGymId|subscription\.|tenantId/);
  assert.match(service, /ProductPlanVersionStatus\.DRAFT/);
  assert.match(service, /serializable/);
  assert.match(service, /PRODUCT_PLAN_ENTITLEMENT_UPDATED/);
  assert.match(module, /FmCommandPlanGovernanceController/);
});

test('FM retirement rejects any referenced version before mutation', async()=>{
  const {ProductEntitlementsService}=require('../dist/src/modules/product-entitlements/product-entitlements.service.js');
  for(const blockedBy of ['tenantProductSubscription','saasPlanPrice','commercialLaunchOffering','commercialLaunchPolicy']){
    let writes=0;
    const tx={productPlanVersion:{findFirst:async()=>({id:'version-a',status:'PUBLISHED',productPlan:{code:'IRON_A'}}),update:async()=>{writes++;}},
      ...Object.fromEntries(['tenantProductSubscription','saasPlanPrice','commercialLaunchOffering','commercialLaunchPolicy'].map(k=>[k,{count:async()=>k===blockedBy?1:0}]))};
    const service=new ProductEntitlementsService({$transaction:async cb=>cb(tx)},{record:async()=>{writes++;}},{});
    await assert.rejects(()=>service.retireVersion('plan-a',1,undefined,true),/Versao vinculada/);
    assert.equal(writes,0);
  }
});
