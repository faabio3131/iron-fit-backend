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
    await page.getByTestId('trial-submit').click();
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
      const layout = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth, viewport: window.innerWidth,
      }));
      assert.ok(layout.document <= layout.viewport + 2,
        `Horizontal overflow at ${viewport.width}: ${JSON.stringify(layout)}`);
    }
    await page.setViewportSize({ width: 1366, height: 768 });

    await page.getByTestId('nav-team').click();
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
      assert.equal(await page.getByTestId('team-invite-submit').isEnabled(), true);
      const invitationResponse = page.waitForResponse((response) =>
        response.url().endsWith('/api/v1/users/invite') && response.request().method() === 'POST');
      await page.getByTestId('team-invite-submit').click();
      const response = await invitationResponse;
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
    await page.getByTestId('nav-students').click();
    await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('QA Student');
    await page.getByRole('textbox', { name: 'E-mail', exact: true }).fill(studentEmail);
    const createdResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/students') && response.request().method() === 'POST');
    await page.getByTestId('student-create').click();
    const studentCreated = await (await createdResponse).json();
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
    await page.getByTestId('nav-equipment').click();
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
      assert.equal(await page.getByTestId('nav-team').count(), employee.role === 'MANAGER' ? 1 : 0);
      assert.equal(await page.getByTestId('nav-workouts').count(), employee.role === 'TRAINER' ? 1 : (employee.role === 'MANAGER' ? 1 : 0));
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
    await page.getByText('Agenda', { exact: true }).last().click();
    await page.getByText('Perfil', { exact: true }).last().click();
    await page.getByTestId('logout-submit').click();
    await page.getByTestId('login-submit').waitFor({ timeout: 15000 });

    console.log(JSON.stringify({ event: 'iron_browser_internal_cert', testedModules: checked + 1, auth: true, invite: true, staffRoles: employees.map(e => e.role), financialNavigationDenied: true, studentSelfService: true, inventoryCtaRoundtrip: true, stepUp: true, logout: true }));
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}, { timeout: 160000 });
