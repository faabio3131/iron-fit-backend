import test from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

const { FinancialController } = await import('../dist/src/modules/financial/financial.controller.js');
const { DashboardController } = await import('../dist/src/modules/dashboard/dashboard.controller.js');

const ownerOnly = ['SUPER_ADMIN', 'OWNER'];

function rolesOf(target) {
  return Reflect.getMetadata('roles', target);
}

test('financial endpoints are restricted to owner and super admin', () => {
  const methods = [
    'createAccount',
    'findAllAccounts',
    'createSubscription',
    'findSubscriptions',
    'createCharge',
    'findAllCharges',
    'findTransactions',
    'createPaymentSession',
    'upsertFiscalScopeBinding',
    'getFiscalScopeBinding',
    'cancelFiscalHandoff',
    'payCharge',
  ];
  for (const method of methods) {
    assert.deepEqual(rolesOf(FinancialController.prototype[method]), ownerOnly, method);
  }
});

test('financial dashboard endpoints are restricted to owner and super admin', () => {
  assert.deepEqual(rolesOf(DashboardController.prototype.getRevenue), ownerOnly);
  assert.deepEqual(rolesOf(DashboardController.prototype.getOverdue), ownerOnly);
});
