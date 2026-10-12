import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(path, 'utf8');

test('O12 billing surface is read-only and declares FM Command authority', async () => {
  const controller = await source('src/modules/saas-billing/saas-billing.controller.ts');

  for (const route of [
    "@Get('authority')",
    "@Get('prices')",
    "@Get('current')",
  ]) {
    assert.equal(controller.includes(route), true, route);
  }

  for (const forbidden of [
    "@Post('prices')",
    "@Post('checkout')",
    "@Post('change-plan')",
    "@Post('cancel')",
    "@Post('refunds')",
    "@Post('admin/recurrence/run')",
    "@Post('admin/dunning/run')",
    "@Post('admin/reconcile')",
    "@Post('webhooks/:providerCode')",
  ]) {
    assert.equal(controller.includes(forbidden), false, forbidden);
  }

  assert.match(controller, /billingAuthority: 'FM_COMMAND'/);
  assert.match(controller, /localMutationsEnabled: false/);
  assert.match(controller, /providerWebhooksAccepted: false/);
  assert.match(controller, /projection: 'LEGACY_READ_ONLY'/);
  assert.match(controller, /@UseGuards\(JwtAuthGuard, RolesGuard, StepUpGuard\)/);
  assert.match(controller, /@Roles\('SUPER_ADMIN', 'OWNER'\)/);
  assert.match(controller, /user\?\.activeGymId \?\? user\?\.gymId/);
});

test('O12 legacy read model remains deterministic while no longer owning mutations', async () => {
  const service = await source('src/modules/saas-billing/saas-billing.service.ts');
  const current = service.slice(
    service.indexOf('async getCurrent'),
    service.indexOf('private async prepareCheckout'),
  );

  assert.equal(current.includes('this.approvedCommercialPolicy()'), true);
  assert.equal(current.includes('commercialPolicy.dunningGraceDays'), true);
  assert.equal(current.includes('commercialPolicy.invoiceDueDays'), true);
  assert.equal(current.includes('gracePeriodEndsAt'), true);
  assert.equal(current.includes('SAAS_BILLING_DUNNING_GRACE_DAYS'), false);
});
