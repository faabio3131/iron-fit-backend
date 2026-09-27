import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(path, 'utf8');

test('B launch runtime authority is persisted and approval is fail-closed', async () => {
  const service = await source(
    'src/modules/commercial-launch/commercial-launch.service.ts',
  );
  const schema = await source('prisma/commercial-launch.prisma');

  for (const model of [
    'CommercialLaunchMatrix',
    'CommercialLaunchItem',
    'CommercialLaunchOffering',
    'CommercialLaunchPolicy',
  ]) {
    assert.match(schema, new RegExp('model ' + model));
  }

  assert.match(service, /CommercialLaunchMatrixStatus\.APPROVED/);
  assert.match(service, /snapshotHash/);
  assert.match(service, /Launch Matrix possui item UNDECIDED/);
  assert.match(service, /Politica comercial\/fiscal do launch ainda incompleta/);
  assert.match(service, /Launch exige ao menos um offering/);
  assert.match(service, /this\.authSecurity\.assertStepUp/);
});

test('B trial runtime consumes exact APPROVED launch policy instead of env plan/day authority', async () => {
  const trial = await source(
    'src/modules/commercial/commercial-trial.service.ts',
  );
  const env = await source('.env.example');

  assert.match(trial, /this\.launch\.currentApproved\(\)/);
  assert.match(trial, /policy\.trialPlanVersionId/);
  assert.match(trial, /policy\.trialDays/);
  assert.match(trial, /productPlanVersion\.findUnique/);
  assert.match(trial, /ProductPlanVersionStatus\.PUBLISHED/);
  assert.doesNotMatch(trial, /IRON_FIT_TRIAL_PLAN_CODE/);
  assert.doesNotMatch(trial, /IRON_FIT_TRIAL_DAYS/);
  assert.doesNotMatch(env, /IRON_FIT_TRIAL_PLAN_CODE=/);
  assert.doesNotMatch(env, /IRON_FIT_TRIAL_DAYS=/);
});

test('B existing trials remain identifiable after future Launch Matrix version changes', async () => {
  const trial = await source(
    'src/modules/commercial/commercial-trial.service.ts',
  );
  const syncStart = trial.indexOf('async synchronizeTrial');
  const syncEnd = trial.indexOf('private async completedSteps', syncStart);
  const sync = trial.slice(syncStart, syncEnd);

  assert.match(sync, /commercialTrialProvisioning\.findFirst/);
  assert.match(sync, /subscriptionId: subscription\.id/);
  assert.doesNotMatch(sync, /trialPlanVersionId/);
  assert.doesNotMatch(sync, /productPlan\.code ===/);
});

test('B billing due and dunning grace consume APPROVED matrix policy, not deploy-time env', async () => {
  const billing = await source(
    'src/modules/saas-billing/saas-billing.service.ts',
  );
  const env = await source('.env.example');

  assert.match(billing, /this\.launch\.currentApproved\(\)/);
  assert.match(billing, /commercialPolicy\.invoiceDueDays/);
  assert.match(billing, /commercialPolicy\.dunningGraceDays/);
  assert.doesNotMatch(billing, /SAAS_BILLING_INVOICE_DUE_DAYS/);
  assert.doesNotMatch(billing, /SAAS_BILLING_DUNNING_GRACE_DAYS/);
  assert.doesNotMatch(env, /SAAS_BILLING_INVOICE_DUE_DAYS=/);
  assert.doesNotMatch(env, /SAAS_BILLING_DUNNING_GRACE_DAYS=/);
});

test('B provider sandbox safety remains runtime-only and is not mistaken for launch policy', async () => {
  const billing = await source(
    'src/modules/saas-billing/saas-billing.service.ts',
  );
  const sandbox = await source(
    'src/modules/saas-billing/adapters/internal-sandbox-billing.adapter.ts',
  );

  assert.match(billing, /SAAS_BILLING_PROVIDER/);
  assert.match(sandbox, /SAAS_BILLING_SANDBOX_ENABLED/);
  assert.match(sandbox, /NODE_ENV/);
  assert.match(sandbox, /production/);
});
