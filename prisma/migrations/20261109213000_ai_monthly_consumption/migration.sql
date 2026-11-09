-- Monthly commercial AI quota ledger; no prompts, health data, or credentials.
CREATE TABLE "AiCreditGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "packageCode" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "sourceInvoiceId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "AiCreditGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiCreditGrant_units_check" CHECK ("units" > 0),
    CONSTRAINT "AiCreditGrant_period_check" CHECK ("periodEnd" > "periodStart")
);
CREATE UNIQUE INDEX "AiCreditGrant_sourceInvoiceId_key" ON "AiCreditGrant"("sourceInvoiceId");
CREATE INDEX "AiCreditGrant_tenantId_group_periodStart_periodEnd_revokedAt_idx" ON "AiCreditGrant"("tenantId","group","periodStart","periodEnd","revokedAt");
CREATE TABLE "AiMonthlyConsumption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "requestId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "AiMonthlyConsumption_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiMonthlyConsumption_state_check" CHECK ("state" IN ('RESERVED', 'CONSUMED', 'RELEASED')),
    CONSTRAINT "AiMonthlyConsumption_period_check" CHECK ("periodEnd" > "periodStart")
);
CREATE UNIQUE INDEX "AiMonthlyConsumption_tenantId_group_periodStart_requestId_key" ON "AiMonthlyConsumption"("tenantId","group","periodStart","requestId");
CREATE INDEX "AiMonthlyConsumption_tenantId_group_periodStart_state_idx" ON "AiMonthlyConsumption"("tenantId","group","periodStart","state");
