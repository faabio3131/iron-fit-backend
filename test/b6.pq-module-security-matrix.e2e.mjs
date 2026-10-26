import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { login, request } from '../scripts/b6-e2e-lib.mjs';

const moduleReadRoutes = Object.freeze({
  onboarding: '/commercial/onboarding',
  students: '/students',
  team: '/users',
  inventory: '/equipments',
  catalog: '/equipments/catalog',
  exercises: '/exercises',
  workouts: '/workouts',
  agendaSlots: '/schedule-slots',
  agendaBookings: '/schedules',
  accessEvents: '/access/events',
  accessCredentials: '/access/credentials',
  accessDevices: '/access/devices',
  financialAccounts: '/financial/accounts',
  financialCharges: '/financial/charges',
  financialSubscriptions: '/financial/subscriptions',
  financialTransactions: '/financial/transactions',
  financialOverdue: '/financial/charges?overdue=true',
  billingAuthority: '/saas-billing/authority',
  billingCurrent: '/saas-billing/current',
  billingPrices: '/saas-billing/prices',
  tenantFeatures: '/product-entitlements/tenant/features',
  tenantConfigurations: '/product-entitlements/tenant/configurations',
  creatorContent: '/creator-network/content/tenant/items',
  creatorOverview: '/creator-network/operations/tenant/overview',
  creatorAnalytics: '/creator-network/operations/tenant/analytics?days=30',
  communicationTemplates: '/communication/templates',
  communicationMessages: '/communication/messages',
  communicationAutomations: '/communication/automations',
  privacyRequests: '/privacy/dsr',
  privacyDocuments: '/privacy/legal-documents',
  privacyAcceptances: '/privacy/legal-acceptances',
  integrationProviders: '/integrations/providers',
  integrationConnections: '/integrations/connections',
  securitySessions: '/auth/sessions',
  fiscalScope: '/financial/fiscal/scope-binding',
});

test('P/Q live module matrix: all canonically exposed read surfaces, role denial and tenant boundaries', async () => {
  const password = process.env.B6_OWNER_PASSWORD;
  const staffPassword = process.env.B6_STAFF_PASSWORD;
  const studentPassword = process.env.B6_STUDENT_PASSWORD;
  assert.ok(password && staffPassword && studentPassword);
  const uid = randomUUID().slice(0, 8);
  const email = `module-owner-${uid}@example.com`;
  const gym = (await request('/commercial/trial/start', {
    method: 'POST', expected: 201,
    body: { requestId: randomUUID(), name: 'Module QA Owner', email, password,
      gymName: `Module QA Gym ${uid}`, timezone: 'America/Sao_Paulo' },
  })).payload;
  const owner = await login(email, password);
  await request('/auth/step-up', { method: 'POST', token: owner.access_token,
    expected: 200, body: { currentPassword: password } });

  const covered = [];
  for (const [capability, path] of Object.entries(moduleReadRoutes)) {
    const result = await request(path, { token: owner.access_token, expected: 200 });
    assert.ok(result.payload !== undefined, `Missing canonical payload at ${capability}`);
    covered.push(capability);
  }

  const employees = [];
  for (const roleName of ['MANAGER', 'RECEPTION', 'TRAINER']) {
    const staffEmail = `${roleName.toLowerCase()}-${uid}@example.com`;
    await request('/users', { method: 'POST', token: owner.access_token, expected: 201,
      body: { name: `Module QA ${roleName}`, email: staffEmail, password: staffPassword, roleName } });
    const session = await login(staffEmail, staffPassword);
    employees.push({ roleName, token: session.access_token });
  }

  const administrative = [
    '/financial/accounts', '/financial/charges', '/financial/subscriptions',
    '/financial/transactions', '/saas-billing/prices', '/saas-billing/current',
    '/product-entitlements/tenant/configurations',
    '/integrations/providers', '/integrations/connections',
    '/financial/fiscal/scope-binding',
  ];
  for (const employee of employees) {
    for (const path of administrative) {
      await request(path, { token: employee.token, expected: 403 });
    }
    await request('/students', { token: employee.token, expected: 200 });
    // Decline privilege escalation even if the client directly crafts the POST.
    await request('/users', { method: 'POST', token: employee.token,
      expected: 403, body: {
        name: 'Unauthorized Owner', email: `escalation-${employee.roleName}-${uid}@example.com`,
        password: staffPassword, roleName: 'OWNER',
      } });
  }
  // Tenant owners cannot reach FM-only privacy operations merely by crafting URLs.
  await request('/privacy/operations/governance', { token: owner.access_token, expected: 403 });
  await request('/privacy/operations/dsr', { token: owner.access_token, expected: 403 });

  // Forged tenant selector cannot expand the JWT's gym context.
  const otherEmail = `other-owner-${uid}@example.com`;
  const otherGym = (await request('/commercial/trial/start', { method: 'POST', expected: 201,
    body: { requestId: randomUUID(), name: 'Other Tenant Owner', email: otherEmail,
      password, gymName: `Other QA Gym ${uid}`, timezone: 'America/Sao_Paulo' },
  })).payload;
  assert.notEqual(gym.gymId, otherGym.gymId);
  await request(`/students?gymId=${otherGym.gymId}`, { token: owner.access_token, expected: 200 });
  const student = (await request('/students', { method: 'POST', expected: 201,
    token: owner.access_token, body: {
      name: 'Module QA Student', email: `module-student-${uid}@example.com`,
      goal: 'CONDICIONAMENTO', level: 'INICIANTE',
    } })).payload;
  await request(`/students/${student.id}/assessments`, { token: owner.access_token, expected: 200 });
  await request('/student-onboarding/accept-invite', { method: 'POST', expected: 201,
    body: { token: student.onboarding.token, password: studentPassword } });
  const studentSession = await login(`module-student-${uid}@example.com`, studentPassword);
  for (const path of ['/students', '/users', '/financial/charges', '/saas-billing/current']) {
    await request(path, { token: studentSession.access_token, expected: 403 });
  }
  for (const path of ['/me/profile', '/me/workouts', '/me/schedules', '/me/charges', '/me/assessments']) {
    await request(path, { token: studentSession.access_token, expected: 200 });
  }
  console.log(JSON.stringify({
    event: 'iron_module_read_security_matrix',
    canonicalReadSurfaces: covered.length, modules: covered,
    employeeRoles: employees.map(x => x.roleName),
    rejectedStaffAdministrativeReads: employees.length * administrative.length,
    studentIsolation: true, crossTenantSource: 'JWT',
  }));
}, { timeout: 120000 });
