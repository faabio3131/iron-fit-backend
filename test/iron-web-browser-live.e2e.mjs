import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire('/tmp/iron-browser-qa/package.json');
const { chromium } = require('playwright-core');

test('Macro O real browser: trial, login, team actions, restricted finance, module navigation and logout', async () => {
  assert.equal(process.env.CI, 'true', 'Browser certification requires the isolated CI database');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/iron_ci');
  const prisma = new PrismaClient();
  const { decryptActionSecret } = createRequire(import.meta.url)('../dist/src/modules/auth/auth-security.js');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  // Module changes schedule data loading on the next event-loop turn. Wait for
  // the canonical GET and its loading view before addressing the new form.
  async function openModule(module, endpoints) {
    await Promise.all([
      ...endpoints.map((endpoint) => page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/v1${endpoint}` &&
        response.request().method() === 'GET').then((response) => assert.equal(response.status(), 200))),
      page.getByTestId(`nav-${module}`).click(),
    ]);
    await page.getByText('Carregando dados canônicos…', { exact: true }).waitFor({ state: 'hidden' });
  }
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const id = randomUUID().slice(0, 8);
  const email = `web-qa-${id}@example.com`;
  const teamEmail = `team-qa-${id}@example.com`;
  const password = process.env.B6_OWNER_PASSWORD;
  assert.ok(password, 'Isolated password must be supplied by CI');
  try {
    const response = await page.goto('http://127.0.0.1:18081', { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.equal(response.status(), 200);

    await page.getByTestId('start-trial').waitFor({ timeout: 25000 });
    await page.getByTestId('start-trial').click();
    await page.getByTestId('trial-submit').click();
    await page.getByText('Informe seu nome', { exact: false }).waitFor();

    await page.getByTestId('trial-name').fill('B6 Browser Owner');
    await page.getByTestId('trial-gym-name').fill(`B6 Browser Gym ${id}`);
    await page.getByTestId('trial-email').fill(email);
    await page.getByTestId('trial-password').fill(password);
    const [trialResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/commercial/trial/start') && response.request().method() === 'POST'),
      page.getByTestId('trial-submit').click(),
    ]);
    assert.equal(trialResponse.status(), 201);
    const trial = await trialResponse.json();
    const trialBody = trialResponse.request().postDataJSON();
    const persisted = await prisma.commercialTrialProvisioning.findUnique({ where: { requestId: trialBody.requestId } });
    assert.equal(persisted.gymId, trial.gymId);
    assert.equal(persisted.trialEndsAt.getTime() - persisted.trialStartedAt.getTime(), 30 * 86400000);
    const subscription = await prisma.tenantProductSubscription.findUnique({ where: { id: persisted.subscriptionId }, include: { planVersion: true } });
    assert.equal(subscription.status, 'ACTIVE');
    assert.equal(subscription.planVersion.status, 'PUBLISHED');
    assert.equal(subscription.gymId, trial.gymId);
    const replay = await page.request.post(`${process.env.B6_API_URL}/commercial/trial/start`, { data: trialBody });
    assert.equal(replay.status(), 201);
    assert.equal((await replay.json()).gymId, trial.gymId);
    assert.equal(await prisma.tenantProductSubscription.count({ where: { gymId: trial.gymId } }), 1);
    const ownerMemberships = await prisma.userRole.findMany({ where: { userId: persisted.userId }, include: { role: true } });
    assert.equal(ownerMemberships.length, 1);
    assert.equal(ownerMemberships[0].role.name, 'OWNER');
    assert.equal(ownerMemberships[0].gymId, trial.gymId);
    await page.getByTestId('login-notice').waitFor({ timeout: 20000 });
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(password);
    await page.getByTestId('login-submit').click();

    await page.getByTestId('commercial-web-app').waitFor({ timeout: 30000 });
    await page.getByTestId('nav-team').waitFor({ timeout: 30000 });
    // Responsive validation uses the real authenticated product DOM, not screenshots or mocks.
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      // React's useWindowDimensions reflows after the browser resize event.
      // Keep the exact overflow assertion, but measure the settled responsive tree.
      await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth + 2, null, { timeout: 5000 }).catch(() => undefined);
      const layout = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth, viewport: window.innerWidth,
      }));
      if (layout.document > layout.viewport + 2) {
        const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('*'))
          .map((element) => ({ tag: element.tagName, testId: element.getAttribute('data-testid'), width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right, position: getComputedStyle(element).position }))
          .filter((item) => item.right > window.innerWidth + 2).slice(0, 20));
        console.error('RESPONSIVE_OVERFLOW_DIAGNOSTIC', JSON.stringify(overflow));
      }
      assert.ok(layout.document <= layout.viewport + 2,
        `Horizontal overflow at ${viewport.width}: ${JSON.stringify(layout)}`);
    }
    await page.setViewportSize({ width: 1366, height: 768 });

    await openModule('team', ['/users']);
    await page.getByTestId('team-invite-submit').waitFor({ timeout: 20000 });
    assert.equal(await page.getByTestId('team-invite-submit').isEnabled(), false, 'Empty team invite must be disabled');

    // Invite each role through the current UI. Recover the isolated delivery token
    // exactly as the identity E2E does; password setup still uses the canonical API.
    const employees = [
      { role: 'MANAGER', email: `manager-ui-${id}@example.com` },
      { role: 'RECEPTION', email: `reception-ui-${id}@example.com` },
      { role: 'TRAINER', email: teamEmail },
    ];
    for (const employee of employees) {
      await page.getByTestId('team-invite-name').fill(`QA ${employee.role}`);
      await page.getByTestId('team-invite-email').fill(employee.email);
      await page.getByTestId(`team-invite-role-${employee.role}`).click();
      await page.waitForFunction(() => {
        const button = document.querySelector('[data-testid="team-invite-submit"]');
        return button && button.getAttribute('aria-disabled') !== 'true' && !button.disabled;
      });
      assert.equal(await page.getByTestId('team-invite-submit').isEnabled(), true);
      const [response] = await Promise.all([
        page.waitForResponse((response) => response.url().endsWith('/api/v1/users/invite') &&
          response.request().method() === 'POST'),
        page.getByTestId('team-invite-submit').click(),
      ]);
      assert.equal(response.status(), 201);
      const invited = await response.json();
      assert.equal(invited.invitation.delivery, 'PASSWORD_SETUP_EMAIL');
      await page.getByText(employee.email, { exact: false }).first().waitFor({ timeout: 20000 });
      const action = await prisma.authActionToken.findFirst({
        where: { userId: invited.id, kind: 'PASSWORD_RESET' }, orderBy: { createdAt: 'desc' },
      });
      assert.ok(action?.deliveryCiphertext);
      const token = decryptActionSecret({ get: (name) => process.env[name] }, action.deliveryCiphertext);
      const setup = await fetch(`${process.env.B6_API_URL}/auth/password/reset/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      assert.equal(setup.status, 200);
    }

    // Real student creation and invitation activation through the canonical API.
    const studentEmail = `student-ui-${id}@example.com`;
    await openModule('students', ['/students']);
    await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('QA Student');
    await page.getByRole('textbox', { name: 'E-mail', exact: true }).fill(studentEmail);
    const [createdResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/v1/students') &&
        response.request().method() === 'POST'),
      page.waitForResponse((response) => response.url().endsWith('/api/v1/students') &&
        response.request().method() === 'GET'),
      page.getByTestId('student-create').click(),
    ]);
    assert.equal(createdResponse.status(), 201);
    await page.getByText('Carregando dados canônicos…', { exact: true }).waitFor({ state: 'hidden' });
    const studentCreated = await createdResponse.json();
    assert.ok(studentCreated.onboarding?.token);
    const studentPassword = process.env.B6_STUDENT_PASSWORD;
    assert.ok(studentPassword);
    const activation = await fetch(`${process.env.B6_API_URL}/student-onboarding/accept-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: studentCreated.onboarding.token, password: studentPassword }),
    });
    assert.equal(activation.status, 201);

    // Verify a real previously nonfunctional-looking inventory CTA through
    // actual browser clicks, persistent API mutation and reverted state.
    await openModule('equipment', ['/equipments', '/equipments/catalog']);
    const catalogItem = page.locator('[data-testid^="equipment-item-"]').first();
    await catalogItem.waitFor({ timeout: 20000 });
    const catalogId = (await catalogItem.getAttribute('data-testid')).slice('equipment-item-'.length);
    await catalogItem.click();
    await page.getByTestId('equipment-catalog-select').click();
    const remove = page.getByTestId(`equipment-remove-${catalogId}`);
    await remove.waitFor({ timeout: 20000 });
    await remove.click();
    await page.getByTestId(`equipment-remove-confirm-${catalogId}`).click();
    await remove.waitFor({ state: 'hidden', timeout: 20000 });
    await catalogItem.click();
    await page.getByTestId('equipment-catalog-select').waitFor({ timeout: 20000 });

    await page.getByTestId('nav-financial').click();
    await page.getByTestId('admin-password-input').waitFor({ timeout: 15000 });
    assert.equal(await page.getByTestId('admin-step-up-submit').isEnabled(), false);
    await page.getByTestId('admin-password-input').fill(password);
    await page.getByTestId('admin-step-up-submit').click();
    await page.getByTestId('admin-password-input').waitFor({ state: 'hidden', timeout: 20000 });

    // Configure the authorized academy desk inside the real OWNER step-up area.
    await page.getByTestId('finance-account-name').fill('Caixa piloto navegador');
    const [deskAccountResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/financial/accounts') && response.request().method() === 'POST'),
      page.getByTestId('finance-create-account').click(),
    ]);
    assert.equal(deskAccountResponse.status(), 201);
    const deskAccount = await deskAccountResponse.json();
    await page.getByTestId(`desk-account-${deskAccount.id}`).waitFor();
    await page.getByTestId('desk-plan-name').fill('Mensal piloto navegador');
    await page.getByTestId('desk-plan-price').fill('159,90');
    const [deskPlanResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/reception/admin/plans') && response.request().method() === 'POST'),
      page.getByTestId('desk-create-plan').click(),
    ]);
    assert.equal(deskPlanResponse.status(), 201);
    const deskPlan = await deskPlanResponse.json();
    await page.getByTestId(`desk-account-${deskAccount.id}`).click();
    const [deskPolicyResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/reception/admin/policy') && response.request().method() === 'POST'),
      page.getByTestId('desk-enable').click(),
    ]);
    assert.equal(deskPolicyResponse.status(), 201);

    const moduleIds = await page.locator('[data-testid^="nav-"]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-testid')).filter(Boolean));
    assert.ok(moduleIds.length >= 12, `Expected core modules, saw ${moduleIds.length}`);
    let checked = 0;
    for (const id of moduleIds) {
      if (id === 'nav-financial') continue;
      await page.getByTestId(id).click();
      await page.getByTestId('commercial-web-app').waitFor();
      checked++;
    }
    assert.ok(checked >= 11);
    assert.deepEqual(pageErrors, [], 'No uncaught browser runtime errors');
    await page.getByTestId('commercial-logout').click();
    await page.getByTestId('login-submit').waitFor({ timeout: 15000 });

    // The browser itself must not expose owner-only modules to employee profiles.
    for (const employee of employees) {
      await page.getByTestId('login-email').fill(employee.email);
      await page.getByTestId('login-password').fill(password);
      await page.getByTestId('login-submit').click();
      await page.getByTestId('nav-students').waitFor({ timeout: 20000 });
      for (const restricted of ['financial', 'fiscal', 'saasBilling', 'entitlements', 'integrations']) {
        assert.equal(await page.getByTestId(`nav-${restricted}`).count(), 0,
          `${employee.role} must not receive ${restricted} navigation`);
      }
      assert.equal(await page.getByTestId('nav-reception').count(), employee.role === 'RECEPTION' ? 1 : 0);
      if (employee.role === 'RECEPTION') {
        await openModule('reception', ['/students']);
        await page.getByTestId(`desk-student-${studentCreated.id}`).waitFor();
        await page.getByTestId(`desk-student-${studentCreated.id}`).click();
        await page.getByTestId(`desk-plan-${deskPlan.id}`).click();
        assert.equal(await page.getByTestId('desk-enroll').isEnabled(), false);
        await page.getByTestId('desk-confirm').click();
        const [saleResponse] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith('/reception/enroll') && response.request().method() === 'POST'),
          page.getByTestId('desk-enroll').click(),
        ]);
        assert.equal(saleResponse.status(), 201);
        const sale = await saleResponse.json();
        assert.equal(sale.charge.status, 'PAID');
        assert.equal(sale.charge.amount, 15990);
        await page.getByTestId('desk-success').waitFor();
        await page.getByTestId('desk-closing').waitFor();
        assert.equal(await prisma.financialTransaction.count({ where: { gymId: trial.gymId, sourceId: sale.charge.id } }), 1);
        await page.getByTestId('nav-access').click();
        await page.getByTestId('reception-access-terminal').waitFor({ timeout: 20000 });
        const eventIds = [];
        const durations = [];
        for (let i = 0; i < 10; i++) {
          await page.getByTestId('terminal-search').fill(studentCreated.id);
          const [response] = await Promise.all([
            page.waitForResponse(r => r.url().endsWith('/access/terminal/check-in') && r.request().method() === 'POST'),
            page.getByTestId('terminal-check-' + studentCreated.id).click(),
          ]);
          assert.equal(response.status(), 201);
          const decision = await response.json();
          assert.equal(decision.allowed, true);
          eventIds.push(decision.eventId);
          const timing = response.request().timing();
          durations.push(timing.responseEnd - timing.requestStart);
        }
        assert.equal(new Set(eventIds).size, 10);
        assert.equal(await prisma.accessEvent.count({ where: { id: { in: eventIds }, gymId: trial.gymId, studentId: studentCreated.id } }), 10);
        assert.equal(await prisma.auditLog.count({ where: { entityId: { in: eventIds }, gymId: trial.gymId, action: 'ACCESS_DECISION_RECORDED' } }), 10);
        assert.ok(durations.every(ms => Number.isFinite(ms) && ms >= 0));
        durations.sort((a, b) => a - b);
        assert.ok(durations[9] < 300, 'Terminal local p95: ' + durations[9] + ' ms');
      }
      assert.equal(await page.getByTestId('nav-team').count(), employee.role === 'MANAGER' ? 1 : 0);
      assert.equal(await page.getByTestId('nav-workouts').count(), employee.role === 'TRAINER' ? 1 : (employee.role === 'MANAGER' ? 1 : 0));
      if (employee.role === 'TRAINER') {
        await openModule('workouts', ['/workouts', '/students']);
        await page.getByTestId('studio-template-adaptation').waitFor();
        await page.getByTestId('studio-template-adaptation').click();
        await page.getByTestId('studio-exercise-load-1-0').fill('Peso corporal');
        await page.getByTestId(`studio-student-${studentCreated.id}`).click();
        const [workoutResponse] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith('/workouts') && response.request().method() === 'POST'),
          page.getByTestId('manual-workout-create').click(),
        ]);
        assert.equal(workoutResponse.status(), 201);
        const workout = await workoutResponse.json();
        assert.equal(workout.status, 'DRAFT');
        assert.equal(workout.createdByAI, false);
        assert.equal(workout.sessions[0].exercises[0].suggestedLoad, 'Peso corporal');
        await page.getByTestId(`workout-approve-${workout.id}`).click();
        const [approval] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith(`/workouts/${workout.id}/status`) && response.request().method() === 'PATCH'),
          page.getByTestId(`workout-review-confirm-${workout.id}`).click(),
        ]);
        assert.equal(approval.status(), 200);
        const [activation] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith(`/workouts/${workout.id}/status`) && response.request().method() === 'PATCH'),
          page.getByTestId(`workout-activate-${workout.id}`).click(),
        ]);
        assert.equal(activation.status(), 200);
      }
      // Mutation completion is followed by canonical permission/tenant refresh.
      // Assert the settled authenticated shell, preserving the exact RBAC check.
      await page.getByTestId('nav-security').waitFor({ timeout: 20000 });
      assert.equal(await page.getByTestId('nav-security').count(), 1);
      await page.getByTestId('commercial-logout').click();
      await page.getByTestId('login-submit').waitFor({ timeout: 15000 });
    }
    // STUDENT uses the six self-service tabs; it never receives the administrative Web workspace.
    await page.getByTestId('login-email').fill(studentEmail);
    await page.getByTestId('login-password').fill(studentPassword);
    await page.getByTestId('login-submit').click();
    await page.getByText('Perfil', { exact: true }).last().waitFor({ timeout: 20000 });
    assert.equal(await page.getByTestId('commercial-web-app').count(), 0);
    for (const tab of ['Treino', 'Intelligence', 'Agenda', 'Evolução', 'Plano', 'Perfil']) {
      assert.ok(await page.getByText(tab, { exact: true }).count() >= 1, `Missing student tab ${tab}`);
    }
    await page.getByText('Treino', { exact: true }).last().click();
    await page.getByText('Peso corporal', { exact: false }).first().waitFor({ timeout: 20000 });
    await page.getByText('Agenda', { exact: true }).last().click();
    await page.getByText('Perfil', { exact: true }).last().click();
    const [qrResponse] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/me/access/qr-code') && r.request().method() === 'POST'),
      page.getByTestId('student-qr-generate').click(),
    ]);
    assert.equal(qrResponse.status(), 201);
    const ownQr = await qrResponse.json();
    assert.match(ownQr.imageDataUrl, /^data:image\/png;base64,iVBOR/);
    assert.equal(ownQr.qrToken, undefined);
    assert.equal(await prisma.accessCredential.count({ where: { id: ownQr.credentialId, studentId: studentCreated.id, selfService: true, active: true } }), 1);
    await page.getByTestId('logout-submit').click();
    await page.getByTestId('login-submit').waitFor({ timeout: 15000 });

    console.log(JSON.stringify({ event: 'iron_browser_internal_cert', testedModules: checked + 1, auth: true, invite: true, staffRoles: employees.map(e => e.role), financialNavigationDenied: true, studentSelfService: true, inventoryCtaRoundtrip: true, stepUp: true, logout: true }));
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}, { timeout: 160000 });
