import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Reflector, NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { RolesGuard } = require('../dist/src/common/guards/roles.guard.js');
const { PermissionsGuard } = require('../dist/src/common/guards/permissions.guard.js');
const { JwtAuthGuard } = require('../dist/src/common/guards/jwt-auth.guard.js');
const { DashboardController } = require('../dist/src/modules/dashboard/dashboard.controller.js');
const { DashboardService } = require('../dist/src/modules/dashboard/dashboard.service.js');
const { FinancialController } = require('../dist/src/modules/financial/financial.controller.js');
const { FinancialService } = require('../dist/src/modules/financial/financial.service.js');
const { UsersController } = require('../dist/src/modules/users/users.controller.js');
const { SaasBillingController } = require('../dist/src/modules/saas-billing/saas-billing.controller.js');
const { TenantProductEntitlementsController } = require('../dist/src/modules/product-entitlements/tenant-product-entitlements.controller.js');
const { PrivacyGovernanceController } = require('../dist/src/modules/privacy/privacy-governance.controller.js');
const { CreatorOperationsController } = require('../dist/src/modules/creator-network/creator-operations.controller.js');
const { publicUserSelect } = require('../dist/src/common/security/public-user-select.js');
const user = (role, permissions = []) => ({ id: 'qa', roles: [role], permissions, gymId: 'gym-a', activeGymId: 'gym-a' });
function permitted(controller, method, actor) {
 const ctx = { getHandler: () => controller.prototype[method], getClass: () => controller, switchToHttp: () => ({ getRequest: () => ({ user: actor }) }) };
 return new RolesGuard(new Reflector()).canActivate(ctx) && new PermissionsGuard(new Reflector()).canActivate(ctx);
}
for (const role of ['OWNER','MANAGER','RECEPTION','TRAINER','STUDENT']) {
 test(`${role}: sensitive actions follow role AND explicit financial grants`, () => {
  const owner = role === 'OWNER';
  assert.equal(permitted(FinancialController, 'findAllCharges', user(role)), owner);
  assert.equal(permitted(FinancialController, 'payCharge', user(role)), owner);
  assert.equal(permitted(FinancialController, 'createAccount', user(role)), owner);
  assert.equal(permitted(UsersController, 'create', user(role)), owner);
  for (const method of ['current','checkout','changePlan','cancel']) assert.equal(permitted(SaasBillingController, method, user(role)), owner);
  for (const method of ['listTenantConfigurations','setTenantConfiguration','resetTenantConfiguration']) assert.equal(permitted(TenantProductEntitlementsController, method, user(role)), owner);
  assert.equal(permitted(CreatorOperationsController, 'getAnalytics', user(role)), owner);
  assert.equal(permitted(PrivacyGovernanceController, 'listRequestsForOperations', user(role)), false);
 });
}
test('read permission does not grant writes; staff grants never elevate trainer/student roles', () => {
 for (const role of ['MANAGER','RECEPTION']) {
  assert.equal(permitted(FinancialController, 'findAllCharges', user(role,['financial:read'])), true);
  assert.equal(permitted(FinancialController, 'payCharge', user(role,['financial:read'])), false);
  assert.equal(permitted(FinancialController, 'payCharge', user(role,['financial:write'])), true);
  assert.equal(permitted(FinancialController, 'createAccount', user(role,['financial:write'])), false);
 }
 for (const role of ['TRAINER','STUDENT']) assert.equal(permitted(FinancialController,'payCharge',user(role,['financial:write'])),false);
});
test('dashboard strips and never queries financial data for unprivileged reception', async () => {
 const prisma = { student: { count: async () => 2 }, equipment: { count: async () => 1 }, workout: { count: async () => 1 }, financialTransaction: { aggregate: async () => { throw Error('financial query forbidden'); } }, charge: { count: async () => { throw Error('financial query forbidden'); } } };
 const controller = new DashboardController(new DashboardService(prisma));
 const result = await controller.getSummary(user('RECEPTION'));
 assert.equal(result.students.total,2); assert.equal('revenue' in result,false); assert.equal('charges' in result,false);
 assert.equal(permitted(DashboardController,'getRevenue',user('MANAGER')),false);
 assert.equal(permitted(DashboardController,'getRevenue',user('MANAGER',['financial:read'])),true);
});
test('dashboard reads reject missing tenant before querying storage', async () => {
 const service = new DashboardService({});
 for (const method of ['getSummary','getRevenueByDay','getAttendance','getOverdueCharges','getUpcomingBirthdays']) await assert.rejects(() => service[method](), /Selecione uma academia/);
});
test('operational user projection excludes authentication data', () => {
 assert.deepEqual(Object.keys(publicUserSelect).sort(), ['active','createdAt','email','id','name','phone']);
});
test('real HTTP guards reject direct financial API access and tenant spoofing', async () => {
 const calls=[];
 class HttpTestModule {}
 const deps=Reflect.getMetadata('design:paramtypes',FinancialController);
 Module({ controllers:[FinancialController], providers: deps.map(token=>({provide:token,useValue: token===FinancialService ? { findAllCharges: async gymId=>{calls.push(gymId);return [];} } : {} })) })(HttpTestModule);
 // Only authentication is stubbed in this isolated, loopback-only harness. Real authorization guards run.
 const original=JwtAuthGuard.prototype.canActivate;
 JwtAuthGuard.prototype.canActivate=()=>true;
 const app=await NestFactory.create(HttpTestModule,{logger:false});
 let actor=user('RECEPTION');app.use((req,_res,next)=>{req.user=actor;next();});
 try {
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  assert.equal((await fetch(`${base}/financial/charges`)).status,403); assert.deepEqual(calls,[]);
  actor=user('RECEPTION',['financial:read']);assert.equal((await fetch(`${base}/financial/charges`)).status,200);assert.deepEqual(calls,['gym-a']);
  assert.equal((await fetch(`${base}/financial/charges?gymId=gym-b`)).status,404);assert.deepEqual(calls,['gym-a']);
  assert.equal((await fetch(`${base}/financial/charges/c-1/pay`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{"accountId":"a-1"}'})).status,403);
 } finally {await app.close();JwtAuthGuard.prototype.canActivate=original;}
});
