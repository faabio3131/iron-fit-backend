import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire('/tmp/iron-browser-qa/package.json');
const { chromium } = require('playwright-core');

test('Macro O real browser: trial, login, team actions, restricted finance, module navigation and logout', async () => {
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
    const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    assert.ok(width.document <= width.viewport + 2, 'Desktop page must not overflow horizontally');

    await page.getByTestId('nav-team').click();
    await page.getByTestId('team-invite').waitFor({ timeout: 20000 });
    assert.equal(await page.getByTestId('team-invite').isEnabled(), false, 'Empty team invite must be disabled');

    await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('B6 Browser Trainer');
    await page.getByRole('textbox', { name: 'E-mail', exact: true }).fill(teamEmail);
    assert.equal(await page.getByTestId('team-invite').isEnabled(), true);
    await page.getByTestId('team-invite').click();
    await page.getByText(teamEmail, { exact: false }).first().waitFor({ timeout: 20000 });

    // Exercise the actual team creation UI for every employee role, not only API authorization.
    const employees = [
      { role: 'MANAGER', label: 'Gerente', email: `manager-ui-${id}@example.com` },
      { role: 'RECEPTION', label: 'Recepção', email: `reception-ui-${id}@example.com` },
      { role: 'TRAINER', label: 'Professor', email: `trainer-ui-${id}@example.com` },
    ];
    for (const employee of employees) {
      await page.getByRole('textbox', { name: 'Nome', exact: true }).fill(`QA ${employee.role}`);
      await page.getByRole('textbox', { name: 'E-mail', exact: true }).fill(employee.email);
      await page.getByLabel('Senha inicial (opcional)').fill(password);
      await page.getByText(employee.label, { exact: true }).first().click();
      assert.equal(await page.getByTestId('team-add').isEnabled(), true);
      await page.getByTestId('team-add').click();
      await page.getByText(employee.email, { exact: false }).first().waitFor({ timeout: 20000 });
    }

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
    console.log(JSON.stringify({ event: 'iron_browser_internal_cert', testedModules: checked + 1, auth: true, invite: true, staffRoles: employees.map(e => e.role), financialNavigationDenied: true, stepUp: true, logout: true }));
  } finally {
    await browser.close();
  }
}, { timeout: 160000 });
