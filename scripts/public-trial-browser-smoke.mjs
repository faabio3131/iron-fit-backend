import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Public browser smoke is strictly read-only: do not submit any form,
// authenticate, create a tenant, send payment, or mutate customer records.
const require = createRequire('/tmp/iron-public-browser/package.json');
const { chromium } = require('playwright-core');

const target = new URL(process.env.IRON_PUBLIC_WEB_URL || '');
assert.equal(target.origin, 'https://app.ironfitcore.com.br');
assert.equal(target.pathname, '/');
const required = [
  'trial-name',
  'trial-gym-name',
  'trial-cnpj',
  'trial-email',
  'trial-password',
  'trial-submit',
];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error.message)));

async function assertSignupVisible() {
  for (const id of required) {
    await page.getByTestId(id).waitFor({ state: 'visible', timeout: 20000 });
  }
}

try {
  const first = await page.goto(target.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  assert.equal(first?.status(), 200);
  await page.getByTestId('start-trial').waitFor({ timeout: 20000 });
  await page.getByTestId('start-trial').click();
  await assertSignupVisible();

  // The official institutional URL must open the same real form directly.
  const direct = new URL('?iniciar-teste=1', target);
  const second = await page.goto(direct.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  assert.equal(second?.status(), 200);
  await assertSignupVisible();
  assert.deepEqual(pageErrors, [], 'Uncaught runtime errors on public trial entry');

  console.log(JSON.stringify({
    event: 'iron_public_trial_browser_smoke_pass',
    url: target.origin,
    test: 'GUEST_CTA_AND_DIRECT_TRIAL_ENTRY',
    checkedFields: required,
    formSubmitted: false,
    customerDataMutated: false,
    authenticated: false,
    javascriptErrors: 0,
  }));
} finally {
  await browser.close();
}
