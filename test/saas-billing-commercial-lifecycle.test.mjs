import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = (path) => readFile(path, 'utf8');

test('Block 3 persists a separate FM-to-academy billing domain', async () => {
  const schema = await source('prisma/schema.prisma');
  const migration = await source('prisma/migrations/20260926021500_saas_billing_lifecycle/migration.sql');
  for (const model of ['SaasPlanPrice','SaasBillingAgreement','SaasCheckoutSession','SaasInvoice','SaasPayment','SaasRefund','SaasWebhookEvent','SaasBillingReconciliation']) {
    assert.match(schema, new RegExp('model ' + model));
    assert.match(migration, new RegExp('CREATE TABLE "' + model + '"'));
  }
  assert.match(schema, /model Subscription \{/);
  assert.match(schema, /model Charge \{/);
  assert.match(schema, /tenantProductSubscriptionId\s+String\s+@unique/);
  assert.match(migration, /SaasBillingAgreement_one_live_per_gym/);
});

test('pricing is PUBLISHED-plan-version based and tenant mutations cannot spoof gymId', async () => {
  const service = await source('src/modules/saas-billing/saas-billing.service.ts');
  const controller = await source('src/modules/saas-billing/saas-billing.controller.ts');
  const dto = await source('src/modules/saas-billing/dto/saas-billing.dto.ts');
  assert.match(service, /ProductPlanVersionStatus\.PUBLISHED/);
  assert.match(service, /priceCode/);
  assert.equal(/if\s*\(\s*plan\s*===/.test(service), false);
  assert.match(controller, /user\?\.activeGymId \?\? user\?\.gymId/);
  assert.match(controller, /@Roles\('OWNER'\)/);
  assert.equal(dto.includes('gymId'), false);
});

test('internal sandbox verifies HMAC and is forbidden in production', async () => {
  const { InternalSandboxBillingAdapter } = require('../dist/src/modules/saas-billing/adapters/internal-sandbox-billing.adapter.js');
  const { canonicalBillingPayload } = require('../dist/src/modules/saas-billing/contracts/saas-billing-provider.port.js');
  const secret = '0123456789abcdef0123456789abcdef';
  const dev = { get(key) {
    if (key === 'SAAS_BILLING_SANDBOX_ENABLED') return 'true';
    if (key === 'SAAS_BILLING_SANDBOX_SECRET') return secret;
    if (key === 'NODE_ENV') return 'development';
    return undefined;
  }};
  const adapter = new InternalSandboxBillingAdapter(dev);
  const payload = { eventId:'evt-1', eventType:'checkout.completed', occurredAt:'2026-09-26T00:00:00.000Z', data:{ providerSessionRef:'sandbox_checkout_a' } };
  const signature = createHmac('sha256', secret).update(canonicalBillingPayload(payload)).digest('hex');
  assert.doesNotThrow(() => adapter.verifyWebhook(payload, 'sha256=' + signature));
  assert.throws(() => adapter.verifyWebhook(payload, 'sha256=' + '0'.repeat(64)));

  const prod = new InternalSandboxBillingAdapter({ get(key) {
    if (key === 'SAAS_BILLING_SANDBOX_ENABLED') return 'true';
    if (key === 'SAAS_BILLING_SANDBOX_SECRET') return secret;
    if (key === 'NODE_ENV') return 'production';
    return undefined;
  }});
  assert.throws(() => prod.assertAvailable(), /proibido neste ambiente/);
});

test('webhook/payment replay and checkout have physical idempotency authorities', async () => {
  const schema = await source('prisma/schema.prisma');
  const controller = await source('src/modules/saas-billing/saas-billing.controller.ts');
  const service = await source('src/modules/saas-billing/saas-billing.service.ts');
  assert.match(schema, /@@unique\(\[providerCode, providerEventId\]\)/);
  assert.match(schema, /@@unique\(\[providerCode, providerPaymentRef\]\)/);
  assert.match(schema, /requestId\s+String\s+@unique/);
  assert.match(controller, /x-saas-billing-signature/);
  assert.match(service, /verifyWebhook\(dto, signature(?:, provider\.context)?\)/);
  assert.match(service, /Webhook eventId reutilizado com payload diferente/);
});

test('paid webhook uses canonical Product subscription lifecycle inside the billing transaction', async () => {
  const billing = await source('src/modules/saas-billing/saas-billing.service.ts');
  const lifecycle = await source('src/modules/product-entitlements/tenant-product-subscription-lifecycle.service.ts');
  assert.match(lifecycle, /transitionWithTx/);
  assert.match(billing, /this\.lifecycle\.transitionWithTx\(\s*tx,/);
  assert.match(billing, /tenantProductSubscriptionId: nextSubscriptionId/);
  assert.equal(billing.includes('.subscription.create'), false);
  assert.equal(billing.includes('.charge.create'), false);
});

test('upgrade, downgrade, recurrence, dunning, refund and reconciliation policies are explicit', async () => {
  const billing = await source('src/modules/saas-billing/saas-billing.service.ts');
  for (const invariant of [
    'IMMEDIATE_REMAINING_PERIOD_DELTA',
    'NO_IMMEDIATE_REFUND_EFFECTIVE_NEXT_PERIOD',
    'SAAS_RECURRING_INVOICE_CREATED',
    'SAAS_DUNNING_PAST_DUE',
    'SAAS_DUNNING_SUSPENDED',
    'REFUND_DOES_NOT_MUTATE_ACCESS',
    'SAAS_BILLING_RECONCILIATION_RUN',
    'SAAS_BILLING_FISCAL_HANDOFF_PENDING_CAPABILITY',
  ]) assert.match(billing, new RegExp(invariant));
  assert.match(billing, /status: TenantProductSubscriptionStatus\.SUSPENDED/);
  assert.match(billing, /data: \{ status: TenantProductSubscriptionStatus\.ACTIVE \}/);
});

test('refund section never mutates canonical access', async () => {
  const billing = await source('src/modules/saas-billing/saas-billing.service.ts');
  const section = billing.slice(billing.indexOf('async refund('), billing.indexOf('async reconcile('));
  assert.equal(section.includes('tenantProductSubscription.update'), false);
  assert.equal(section.includes('tenantProductSubscription.updateMany'), false);
  assert.match(section, /Refund excede valor pago do invoice SaaS/);
});

test('documentation and environment make external-homologation boundary explicit', async () => {
  const doc = await source('docs/SAAS_BILLING_COMMERCIAL_LIFECYCLE.md');
  const env = await source('.env.example');
  const workflow = await source('.github/workflows/iron-s0-quality.yml');
  assert.match(doc, /não representa gateway externo homologado/);
  assert.match(doc, /não significa emissão fiscal real/);
  assert.match(env, /SAAS_BILLING_SANDBOX_ENABLED=false/);
  assert.match(env, /dunning grace are governed by the APPROVED Commercial Launch Matrix/);
  assert.doesNotMatch(env, /SAAS_BILLING_DUNNING_GRACE_DAYS=/);
  assert.doesNotMatch(env, /SAAS_BILLING_INVOICE_DUE_DAYS=/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /npx prisma generate/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm run test:smoke/);
});
