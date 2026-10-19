import test from 'node:test';
import assert from 'node:assert/strict';

const { StepUpService } = await import('../dist/src/modules/auth/step-up.service.js');

test('administrative step-up is session-bound and expires', async () => {
  let storedExpiry = null;
  const prisma = {
    session: {
      updateMany: async ({ where, data }) => {
        assert.equal(where.id, 'session-1');
        assert.equal(where.userId, 'user-1');
        storedExpiry = data.stepUpExpiresAt;
        return { count: 1 };
      },
      findFirst: async ({ where }) => {
        if (where.id !== 'session-1' || where.userId !== 'user-1') return null;
        return { stepUpExpiresAt: storedExpiry };
      },
    },
  };
  const service = new StepUpService(prisma);
  const granted = await service.grant('user-1', 'session-1');
  assert.equal(granted.active, true);
  assert.ok(granted.expiresAt > new Date());
  assert.equal((await service.status('user-1', 'session-1')).active, true);
});

test('WP03 session-bound administrative step-up denies expiry, revocation and session mismatch', async () => {
  const { ADMIN_STEP_UP_TTL_MS } = await import('../dist/src/modules/auth/step-up.service.js');
  assert.equal(ADMIN_STEP_UP_TTL_MS, 15 * 60 * 1000);
  let stored = null;
  let revoked = false;
  const prisma = { session: {
    updateMany: async ({ where, data }) => {
      assert.equal(where.revokedAt, null);
      if (revoked) return { count: 0 };
      stored = data.stepUpExpiresAt;
      return { count: 1 };
    },
    findFirst: async ({ where }) => {
      if (revoked || where.id !== 'session-1' || where.userId !== 'user-1') return null;
      return { stepUpExpiresAt: stored };
    },
  } };
  const service = new StepUpService(prisma);
  await service.grant('user-1','session-1');
  assert.equal((await service.status('user-1','session-1')).active,true);
  assert.equal((await service.status('other','session-1')).active,false);
  assert.equal((await service.status('user-1','different-session')).active,false);
  stored = new Date(Date.now()-1000);
  await assert.rejects(() => service.assertActive('user-1','session-1'), /Reautenticacao administrativa necessaria/);
  revoked = true;
  await assert.rejects(() => service.grant('user-1','session-1'), /Sessao invalida/);
  await assert.rejects(() => service.assertActive('user-1','session-1'), /Reautenticacao administrativa necessaria/);
});

test('WP03 six-role denial matrix protects finance, SaaS billing, integrations and tenant configuration', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  require('reflect-metadata');
  const { Reflector } = require('@nestjs/core');
  const { RolesGuard } = require('../dist/src/common/guards/roles.guard.js');
  const { FinancialController } = require('../dist/src/modules/financial/financial.controller.js');
  const { DashboardController } = require('../dist/src/modules/dashboard/dashboard.controller.js');
  const { SaasBillingController } = require('../dist/src/modules/saas-billing/saas-billing.controller.js');
  const { IntegrationCredentialTenantController } = require('../dist/src/modules/integrations/integration-credential-tenant.controller.js');
  const { TenantProductEntitlementsController } = require('../dist/src/modules/product-entitlements/tenant-product-entitlements.controller.js');
  const { GUARDS_METADATA } = require('@nestjs/common/constants');
  const matrix = [
    [FinancialController,'findAllCharges'], [FinancialController,'createPaymentSession'],
    [DashboardController,'getRevenue'], [DashboardController,'getOverdue'],
    [SaasBillingController,'current'],
    [IntegrationCredentialTenantController,'list'],
    [TenantProductEntitlementsController,'listTenantConfigurations'],
  ];
  const guard = new RolesGuard(new Reflector());
  for (const [controller, method] of matrix) {
    const handler = controller.prototype[method];
    assert.equal(typeof handler,'function');
    for (const role of ['SUPER_ADMIN','OWNER','MANAGER','RECEPTION','TRAINER','STUDENT']) {
      const ctx = {
        getClass: () => controller,
        getHandler: () => handler,
        switchToHttp: () => ({ getRequest: () => ({ user: { roles: [role] } }) }),
      };
      assert.equal(guard.canActivate(ctx),['SUPER_ADMIN','OWNER'].includes(role), controller.name + '.' + method + ': ' + role);
    }
  }
  for (const cls of [FinancialController,SaasBillingController,IntegrationCredentialTenantController]) {
    const guards = Reflect.getMetadata(GUARDS_METADATA,cls) || [];
    assert.ok(guards.some(g => g.name==='StepUpGuard'),cls.name);
  }
  for (const method of ['getRevenue','getOverdue']) {
    const guards=Reflect.getMetadata(GUARDS_METADATA,DashboardController.prototype[method]) || [];
    assert.ok(guards.some(g=>g.name==='StepUpGuard'),method);
  }
  for (const method of ['listTenantConfigurations','setTenantConfiguration','resetTenantConfiguration']) {
    const guards=Reflect.getMetadata(GUARDS_METADATA,TenantProductEntitlementsController.prototype[method]) || [];
    assert.ok(guards.some(g=>g.name==='StepUpGuard'),method);
  }
});
