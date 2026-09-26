-- IRON Commercial Block 3 — SaaS Billing Lifecycle
-- Additive FM -> academy billing domain. It never reuses the student's financial Subscription/Charge tables.

CREATE TYPE "SaasBillingInterval" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "SaasBillingAgreementStatus" AS ENUM ('PENDING_CHECKOUT', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED');
CREATE TYPE "SaasCheckoutStatus" AS ENUM ('PENDING', 'READY', 'COMPLETED', 'EXPIRED', 'CANCELED', 'FAILED');
CREATE TYPE "SaasInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
CREATE TYPE "SaasPaymentStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'REFUNDED');
CREATE TYPE "SaasRefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "SaasWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'REJECTED', 'FAILED');
CREATE TYPE "SaasReconciliationStatus" AS ENUM ('MATCHED', 'MISMATCH');

CREATE TABLE "SaasPlanPrice" (
  "id" TEXT NOT NULL,
  "priceCode" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "amountMinor" INTEGER NOT NULL,
  "interval" "SaasBillingInterval" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SaasPlanPrice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SaasPlanPrice_amount_positive" CHECK ("amountMinor" > 0),
  CONSTRAINT "SaasPlanPrice_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "SaasPlanPrice_effective_window" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
);

CREATE TABLE "SaasBillingAgreement" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "tenantProductSubscriptionId" TEXT NOT NULL,
  "priceId" TEXT,
  "status" "SaasBillingAgreementStatus" NOT NULL DEFAULT 'PENDING_CHECKOUT',
  "providerCode" TEXT NOT NULL,
  "providerCustomerRef" TEXT,
  "providerSubscriptionRef" TEXT,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "nextBillingAt" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "canceledAt" TIMESTAMP(3),
  "pastDueSince" TIMESTAMP(3),
  "pendingTransition" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SaasBillingAgreement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SaasBillingAgreement_period_window" CHECK ("currentPeriodEnd" IS NULL OR "currentPeriodStart" IS NULL OR "currentPeriodEnd" > "currentPeriodStart")
);

CREATE TABLE "SaasCheckoutSession" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "priceId" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "providerSessionRef" TEXT,
  "checkoutUrl" TEXT,
  "status" "SaasCheckoutStatus" NOT NULL DEFAULT 'PENDING',
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SaasCheckoutSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SaasCheckoutSession_amount_positive" CHECK ("amountMinor" >= 0),
  CONSTRAINT "SaasCheckoutSession_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "SaasInvoice" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "priceId" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "providerInvoiceRef" TEXT,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "amountDueMinor" INTEGER NOT NULL,
  "amountPaidMinor" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL,
  "status" "SaasInvoiceStatus" NOT NULL DEFAULT 'OPEN',
  "dueAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SaasInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SaasInvoice_period_window" CHECK ("periodEnd" > "periodStart"),
  CONSTRAINT "SaasInvoice_amounts_valid" CHECK ("amountDueMinor" >= 0 AND "amountPaidMinor" >= 0),
  CONSTRAINT "SaasInvoice_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "SaasPayment" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "providerPaymentRef" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "SaasPaymentStatus" NOT NULL,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaasPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SaasPayment_amount_positive" CHECK ("amountMinor" > 0),
  CONSTRAINT "SaasPayment_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "SaasRefund" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "paymentId" TEXT,
  "providerCode" TEXT NOT NULL,
  "providerRefundRef" TEXT,
  "amountMinor" INTEGER NOT NULL,
  "status" "SaasRefundStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SaasRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SaasRefund_amount_positive" CHECK ("amountMinor" > 0)
);

CREATE TABLE "SaasWebhookEvent" (
  "id" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" "SaasWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
  "errorCode" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "SaasWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaasBillingReconciliation" (
  "id" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "status" "SaasReconciliationStatus" NOT NULL,
  "expectedAmountMinor" INTEGER,
  "observedAmountMinor" INTEGER,
  "details" JSONB,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaasBillingReconciliation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SaasBillingReconciliation_amounts_valid" CHECK (
    ("expectedAmountMinor" IS NULL OR "expectedAmountMinor" >= 0)
    AND ("observedAmountMinor" IS NULL OR "observedAmountMinor" >= 0)
  )
);

CREATE UNIQUE INDEX "SaasPlanPrice_priceCode_key" ON "SaasPlanPrice"("priceCode");
CREATE INDEX "SaasPlanPrice_planVersionId_active_idx" ON "SaasPlanPrice"("planVersionId", "active");
CREATE INDEX "SaasPlanPrice_currency_interval_active_idx" ON "SaasPlanPrice"("currency", "interval", "active");

CREATE UNIQUE INDEX "SaasBillingAgreement_tenantProductSubscriptionId_key" ON "SaasBillingAgreement"("tenantProductSubscriptionId");
CREATE UNIQUE INDEX "SaasBillingAgreement_providerCode_providerSubscriptionRef_key" ON "SaasBillingAgreement"("providerCode", "providerSubscriptionRef");
CREATE INDEX "SaasBillingAgreement_gymId_status_idx" ON "SaasBillingAgreement"("gymId", "status");
CREATE INDEX "SaasBillingAgreement_status_nextBillingAt_idx" ON "SaasBillingAgreement"("status", "nextBillingAt");
CREATE UNIQUE INDEX "SaasBillingAgreement_one_live_per_gym"
  ON "SaasBillingAgreement"("gymId")
  WHERE "status" <> 'CANCELED';

CREATE UNIQUE INDEX "SaasCheckoutSession_requestId_key" ON "SaasCheckoutSession"("requestId");
CREATE UNIQUE INDEX "SaasCheckoutSession_providerCode_providerSessionRef_key" ON "SaasCheckoutSession"("providerCode", "providerSessionRef");
CREATE INDEX "SaasCheckoutSession_gymId_status_createdAt_idx" ON "SaasCheckoutSession"("gymId", "status", "createdAt");
CREATE INDEX "SaasCheckoutSession_agreementId_status_idx" ON "SaasCheckoutSession"("agreementId", "status");

CREATE UNIQUE INDEX "SaasInvoice_idempotencyKey_key" ON "SaasInvoice"("idempotencyKey");
CREATE UNIQUE INDEX "SaasInvoice_providerCode_providerInvoiceRef_key" ON "SaasInvoice"("providerCode", "providerInvoiceRef");
CREATE INDEX "SaasInvoice_gymId_status_dueAt_idx" ON "SaasInvoice"("gymId", "status", "dueAt");
CREATE INDEX "SaasInvoice_agreementId_periodStart_idx" ON "SaasInvoice"("agreementId", "periodStart");

CREATE UNIQUE INDEX "SaasPayment_providerCode_providerPaymentRef_key" ON "SaasPayment"("providerCode", "providerPaymentRef");
CREATE INDEX "SaasPayment_invoiceId_status_idx" ON "SaasPayment"("invoiceId", "status");

CREATE UNIQUE INDEX "SaasRefund_requestId_key" ON "SaasRefund"("requestId");
CREATE UNIQUE INDEX "SaasRefund_providerCode_providerRefundRef_key" ON "SaasRefund"("providerCode", "providerRefundRef");
CREATE INDEX "SaasRefund_invoiceId_status_idx" ON "SaasRefund"("invoiceId", "status");

CREATE UNIQUE INDEX "SaasWebhookEvent_providerCode_providerEventId_key" ON "SaasWebhookEvent"("providerCode", "providerEventId");
CREATE INDEX "SaasWebhookEvent_status_receivedAt_idx" ON "SaasWebhookEvent"("status", "receivedAt");

CREATE INDEX "SaasBillingReconciliation_agreementId_checkedAt_idx" ON "SaasBillingReconciliation"("agreementId", "checkedAt");
CREATE INDEX "SaasBillingReconciliation_status_checkedAt_idx" ON "SaasBillingReconciliation"("status", "checkedAt");

ALTER TABLE "SaasPlanPrice"
  ADD CONSTRAINT "SaasPlanPrice_planVersionId_fkey"
  FOREIGN KEY ("planVersionId") REFERENCES "ProductPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaasBillingAgreement"
  ADD CONSTRAINT "SaasBillingAgreement_gymId_fkey"
  FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaasBillingAgreement"
  ADD CONSTRAINT "SaasBillingAgreement_tenantProductSubscriptionId_fkey"
  FOREIGN KEY ("tenantProductSubscriptionId") REFERENCES "TenantProductSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaasBillingAgreement"
  ADD CONSTRAINT "SaasBillingAgreement_priceId_fkey"
  FOREIGN KEY ("priceId") REFERENCES "SaasPlanPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaasCheckoutSession"
  ADD CONSTRAINT "SaasCheckoutSession_gymId_fkey"
  FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaasCheckoutSession"
  ADD CONSTRAINT "SaasCheckoutSession_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "SaasBillingAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaasCheckoutSession"
  ADD CONSTRAINT "SaasCheckoutSession_priceId_fkey"
  FOREIGN KEY ("priceId") REFERENCES "SaasPlanPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaasInvoice"
  ADD CONSTRAINT "SaasInvoice_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "SaasBillingAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaasInvoice"
  ADD CONSTRAINT "SaasInvoice_gymId_fkey"
  FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaasInvoice"
  ADD CONSTRAINT "SaasInvoice_priceId_fkey"
  FOREIGN KEY ("priceId") REFERENCES "SaasPlanPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaasPayment"
  ADD CONSTRAINT "SaasPayment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "SaasInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaasRefund"
  ADD CONSTRAINT "SaasRefund_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "SaasInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaasRefund"
  ADD CONSTRAINT "SaasRefund_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "SaasPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaasBillingReconciliation"
  ADD CONSTRAINT "SaasBillingReconciliation_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "SaasBillingAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaasBillingReconciliation"
  ADD CONSTRAINT "SaasBillingReconciliation_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "SaasInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
