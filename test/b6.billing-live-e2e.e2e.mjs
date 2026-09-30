import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  DAY,
  billingWebhook,
  login,
  plus,
  request,
} from '../scripts/b6-e2e-lib.mjs';

const prisma = new PrismaClient();

test('B6 live SaaS billing trial-to-paid, plan changes, dunning and reactivation', async () => {
  const suffix = randomUUID().slice(0, 8);
  const ownerPassword = process.env.B6_OWNER_PASSWORD;
  const adminPassword = process.env.B6_ADMIN_PASSWORD;
  assert.ok(ownerPassword && adminPassword);

  const email = `b6-billing-${suffix}@example.com`;
  const trial = (await request('/commercial/trial/start', {
    method: 'POST',
    expected: 201,
    body: {
      requestId: randomUUID(),
      email,
      password: ownerPassword,
      name: 'B6 Billing Owner',
      gymName: `B6 Billing ${suffix}`,
      timezone: 'America/Sao_Paulo',
    },
  })).payload;
  const owner = await login(email, ownerPassword);
  const admin = await login('b6-admin@example.com', adminPassword);

  await request('/saas-billing/prices', {
    token: owner.access_token,
    expected: 403,
  });
  await request('/auth/step-up', {
    method: 'POST',
    token: owner.access_token,
    expected: 200,
    body: { currentPassword: ownerPassword },
  });
  await request('/auth/step-up', {
    method: 'POST',
    token: admin.access_token,
    expected: 200,
    body: { currentPassword: adminPassword },
  });

  const prices = (await request('/saas-billing/prices', {
    token: owner.access_token,
    expected: 200,
  })).payload;
  const basic = prices.find((item) => item.priceCode === 'IRON_B6_BASIC_MONTHLY');
  const pro = prices.find((item) => item.priceCode === 'IRON_B6_PRO_MONTHLY');
  assert.ok(basic && pro);

  const checkout = (await request('/saas-billing/checkout', {
    method: 'POST',
    token: owner.access_token,
    expected: 201,
    body: { requestId: randomUUID(), priceCode: basic.priceCode },
  })).payload;
  const periodStart = new Date();
  const periodEnd = plus(periodStart, 30 * DAY);

  await billingWebhook('invoice.paid', {
    providerSessionRef: checkout.providerSessionRef,
    providerInvoiceRef: `b6-basic-${suffix}`,
    providerPaymentRef: `b6-basic-pay-${suffix}`,
    amountMinor: checkout.amountMinor,
    currency: checkout.currency,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    providerSubscriptionRef: `b6-sub-${suffix}`,
  }, periodStart);

  let billing = (await request('/saas-billing/current', {
    token: owner.access_token,
    expected: 200,
  })).payload;
  assert.equal(billing.agreement.status, 'ACTIVE');
  assert.equal(billing.agreement.price.priceCode, basic.priceCode);
  assert.equal((await request('/commercial/trial/status', {
    token: owner.access_token,
    expected: 200,
  })).payload.status, 'ACTIVE');

  const upgrade = (await request('/saas-billing/change-plan', {
    method: 'POST',
    token: owner.access_token,
    expected: 201,
    body: {
      requestId: randomUUID(),
      priceCode: pro.priceCode,
      transitionKind: 'UPGRADE',
      reason: 'B6 upgrade',
    },
  })).payload;
  assert.equal(upgrade.proration.policy, 'IMMEDIATE_REMAINING_PERIOD_DELTA');

  await billingWebhook('invoice.paid', {
    providerSessionRef: upgrade.checkout.providerSessionRef,
    providerInvoiceRef: `b6-pro-${suffix}`,
    providerPaymentRef: `b6-pro-pay-${suffix}`,
    amountMinor: upgrade.checkout.amountMinor,
    currency: upgrade.checkout.currency,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    providerSubscriptionRef: `b6-sub-${suffix}`,
  }, plus(periodStart, 1000));

  billing = (await request('/saas-billing/current', {
    token: owner.access_token,
    expected: 200,
  })).payload;
  assert.equal(billing.agreement.price.priceCode, pro.priceCode);

  const downgrade = (await request('/saas-billing/change-plan', {
    method: 'POST',
    token: owner.access_token,
    expected: 201,
    body: {
      requestId: randomUUID(),
      priceCode: basic.priceCode,
      transitionKind: 'DOWNGRADE',
      reason: 'B6 downgrade',
    },
  })).payload;
  assert.equal(downgrade.proration.policy, 'NO_IMMEDIATE_REFUND_EFFECTIVE_NEXT_PERIOD');

  await request('/saas-billing/admin/recurrence/run', {
    method: 'POST',
    token: admin.access_token,
    expected: 201,
    body: { asOf: plus(downgrade.scheduledFor, 1000).toISOString() },
  });

  const agreement = await prisma.saasBillingAgreement.findFirstOrThrow({
    where: { gymId: trial.gymId, status: { not: 'CANCELED' } },
  });
  const invoice = await prisma.saasInvoice.findFirstOrThrow({
    where: {
      agreementId: agreement.id,
      status: 'OPEN',
      price: { priceCode: basic.priceCode },
    },
    orderBy: { createdAt: 'desc' },
  });

  const failedAt = plus(invoice.dueAt, DAY);
  await billingWebhook('invoice.payment_failed', {
    invoiceId: invoice.id,
    providerPaymentRef: `b6-failed-${suffix}`,
    amountMinor: invoice.amountDueMinor,
    currency: invoice.currency,
  }, failedAt);

  await request('/saas-billing/admin/dunning/run', {
    method: 'POST',
    token: admin.access_token,
    expected: 201,
    body: { asOf: plus(failedAt, 6 * DAY).toISOString() },
  });

  const suspended = await prisma.saasBillingAgreement.findUniqueOrThrow({
    where: { id: agreement.id },
    include: { productSubscription: true },
  });
  assert.equal(suspended.status, 'SUSPENDED');
  assert.equal(suspended.productSubscription.status, 'SUSPENDED');

  const featuresWhileSuspended = (await request('/product-entitlements/tenant/features', {
    token: owner.access_token,
    expected: 200,
  })).payload;
  assert.equal(
    featuresWhileSuspended.find((item) => item.featureKey === 'equipment.inventory').value,
    false,
  );

  await billingWebhook('invoice.paid', {
    invoiceId: invoice.id,
    providerPaymentRef: `b6-recovered-${suffix}`,
    amountMinor: invoice.amountDueMinor,
    currency: invoice.currency,
  }, plus(failedAt, 6 * DAY + 60_000));

  billing = (await request('/saas-billing/current', {
    token: owner.access_token,
    expected: 200,
  })).payload;
  assert.equal(billing.agreement.status, 'ACTIVE');
  assert.equal(billing.agreement.price.priceCode, basic.priceCode);

  const featuresAfterPayment = (await request('/product-entitlements/tenant/features', {
    token: owner.access_token,
    expected: 200,
  })).payload;
  assert.equal(
    featuresAfterPayment.find((item) => item.featureKey === 'equipment.inventory').value,
    true,
  );

  const reconciliation = (await request('/saas-billing/admin/reconcile', {
    method: 'POST',
    token: admin.access_token,
    expected: 201,
  })).payload;
  assert.equal(reconciliation.mismatches, 0);
}, { timeout: 60000 });

test.after(async () => {
  await prisma.$disconnect();
});
