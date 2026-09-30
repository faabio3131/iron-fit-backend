import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(path, 'utf8');

test('O11 financial workspace remains owner-only, step-up protected and separate from SaaS billing', async () => {
  const controller = await source('src/modules/financial/financial.controller.ts');

  assert.match(controller, /@Controller\('financial'\)/);
  assert.match(controller, /@UseGuards\(JwtAuthGuard, RolesGuard, StepUpGuard\)/);
  assert.match(controller, /@Get\('transactions'\)/);
  assert.match(
    controller,
    /@Get\('transactions'\)[\s\S]*?@Roles\('SUPER_ADMIN', 'OWNER'\)/,
  );
  assert.doesNotMatch(controller, /saas-billing|SaasBilling/i);
});

test('O11 filtered financial reads derive tenant from authenticated scope', async () => {
  const controller = await source('src/modules/financial/financial.controller.ts');
  const service = await source('src/modules/financial/financial.service.ts');

  assert.match(controller, /resolveTenantOperationGymId/);
  assert.match(controller, /activeGymId: user\.activeGymId \?\? user\.gymId/);
  assert.match(service, /async findSubscriptions\(/);
  assert.match(service, /async findAllCharges\(/);
  assert.match(service, /async findTransactions\(/);
  assert.match(service, /gymId,/);
  assert.doesNotMatch(service, /dto\.gymId \|\| userGymId/);
});

test('O11 transaction history exposes operational payment facts without billing provider internals', async () => {
  const service = await source('src/modules/financial/financial.service.ts');
  const section = service.slice(
    service.indexOf('async findTransactions'),
    service.lastIndexOf('}'),
  );

  for (const marker of [
    'description: true',
    'amount: true',
    'paidAt: true',
    'status: true',
    'studentId: true',
    'paymentMethod: true',
    'account:',
  ]) {
    assert.equal(section.includes(marker), true, marker);
  }
  assert.equal(section.includes('providerCustomerRef'), false);
  assert.equal(section.includes('providerSubscriptionRef'), false);
  assert.equal(section.includes('providerInvoiceRef'), false);
});
