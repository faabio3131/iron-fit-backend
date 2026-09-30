import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(path, 'utf8');

test('O12 billing owner surface remains step-up protected and tenant-derived', async () => {
  const controller = await source('src/modules/saas-billing/saas-billing.controller.ts');

  for (const route of [
    "@Get('prices')",
    "@Get('current')",
    "@Post('checkout')",
    "@Post('change-plan')",
    "@Post('cancel')",
  ]) {
    assert.equal(controller.includes(route), true, route);
  }
  assert.match(controller, /@UseGuards\(JwtAuthGuard, RolesGuard, StepUpGuard\)/);
  assert.match(controller, /@Roles\('SUPER_ADMIN', 'OWNER'\)/);
  assert.match(controller, /user\?\.activeGymId \?\? user\?\.gymId/);
});

test('O12 refund and operational dunning remain SUPER_ADMIN authority', async () => {
  const controller = await source('src/modules/saas-billing/saas-billing.controller.ts');

  assert.match(
    controller,
    /@Post\('refunds'\)[\s\S]*?@Roles\('SUPER_ADMIN'\)/,
  );
  assert.match(
    controller,
    /@Post\('admin\/dunning\/run'\)[\s\S]*?@Roles\('SUPER_ADMIN'\)/,
  );
});

test('O12 current read model derives grace period only from APPROVED commercial policy', async () => {
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
