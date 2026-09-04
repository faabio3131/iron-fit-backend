-- CreateEnum
CREATE TYPE "AggregatorConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'DEGRADED', 'SUSPENDED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "AggregatorMembershipStatus" AS ENUM ('UNKNOWN', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AggregatorAgreementStatus" AS ENUM ('REQUIRED', 'SIGNED', 'SUPERSEDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AggregatorEligibilityStatus" AS ENUM ('UNKNOWN', 'ELIGIBLE', 'INELIGIBLE');

-- CreateEnum
CREATE TYPE "AggregatorVisitStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DENIED', 'PROVISIONAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AggregatorProvisionalDecisionStatus" AS ENUM ('APPROVED', 'DENIED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AggregatorRevalidationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AggregatorSettlementStatus" AS ENUM ('EXPECTED', 'CONFIRMED', 'RECEIVED', 'DIVERGENT', 'DISPUTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AggregatorReconciliationStatus" AS ENUM ('PENDING', 'RECONCILED', 'MISSING_PROVIDER_CHECKIN', 'MISSING_PHYSICAL_ENTRY', 'UNPAID_RISK', 'AMOUNT_DIVERGENCE', 'DUPLICATE', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "AggregatorRiskStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "AggregatorProviderConnection" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "externalLocationId" TEXT,
    "status" "AggregatorConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "capabilities" JSONB NOT NULL,
    "configuration" JSONB,
    "contractVersion" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AggregatorProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatorMember" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "studentId" TEXT,
    "externalMemberId" TEXT NOT NULL,
    "providerStatus" TEXT,
    "provenance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AggregatorMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatorMembership" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "externalMembershipId" TEXT,
    "status" "AggregatorMembershipStatus" NOT NULL DEFAULT 'UNKNOWN',
    "planCode" TEXT,
    "providerStatus" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "provenance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AggregatorMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatorAgreement" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "AggregatorAgreementStatus" NOT NULL DEFAULT 'REQUIRED',
    "documentHash" TEXT,
    "signedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "provenance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AggregatorAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatorEligibilityCheck" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "membershipId" TEXT,
    "externalCheckId" TEXT,
    "status" "AggregatorEligibilityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "providerStatus" TEXT,
    "reasonCode" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "scope" JSONB,
    "provenance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AggregatorEligibilityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatorVisitAuthorization" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "agreementId" TEXT,
    "eligibilityCheckId" TEXT,
    "externalVisitId" TEXT,
    "status" "AggregatorVisitStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorizedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "denialReason" TEXT,
    "provenance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AggregatorVisitAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatorAccessEventLink" (
    "id" TEXT NOT NULL,
    "visitAuthorizationId" TEXT NOT NULL,
    "accessEventId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AggregatorAccessEventLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatorProvisionalDecision" (
    "id" TEXT NOT NULL,
    "visitAuthorizationId" TEXT NOT NULL,
    "status" "AggregatorProvisionalDecisionStatus" NOT NULL,
    "policyVersion" TEXT,
    "reason" TEXT NOT NULL,
    "authorizedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AggregatorProvisionalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatorRevalidationAttempt" (
    "id" TEXT NOT NULL,
    "visitAuthorizationId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "AggregatorRevalidationStatus" NOT NULL DEFAULT 'PENDING',
    "externalCheckId" TEXT,
    "reasonCode" TEXT,
    "provenance" JSONB,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AggregatorRevalidationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatorSettlement" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "visitAuthorizationId" TEXT,
    "externalSettlementId" TEXT,
    "externalVisitId" TEXT,
    "status" "AggregatorSettlementStatus" NOT NULL DEFAULT 'EXPECTED',
    "amountExpected" INTEGER,
    "amountConfirmed" INTEGER,
    "currency" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "providerStatus" TEXT,
    "provenance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AggregatorSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatorReconciliation" (
    "id" TEXT NOT NULL,
    "visitAuthorizationId" TEXT,
    "accessEventLinkId" TEXT,
    "settlementId" TEXT,
    "status" "AggregatorReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "details" JSONB,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AggregatorReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatorRiskCase" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "visitAuthorizationId" TEXT,
    "reconciliationId" TEXT,
    "settlementId" TEXT,
    "type" TEXT NOT NULL,
    "status" "AggregatorRiskStatus" NOT NULL DEFAULT 'OPEN',
    "potentialAmount" INTEGER,
    "currency" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AggregatorRiskCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AggregatorProviderConnection_gymId_providerCode_key" ON "AggregatorProviderConnection"("gymId", "providerCode");

-- CreateIndex
CREATE INDEX "AggregatorProviderConnection_providerCode_status_idx" ON "AggregatorProviderConnection"("providerCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatorMember_connectionId_externalMemberId_key" ON "AggregatorMember"("connectionId", "externalMemberId");

-- CreateIndex
CREATE INDEX "AggregatorMember_studentId_idx" ON "AggregatorMember"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatorMembership_memberId_externalMembershipId_key" ON "AggregatorMembership"("memberId", "externalMembershipId");

-- CreateIndex
CREATE INDEX "AggregatorMembership_memberId_status_idx" ON "AggregatorMembership"("memberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatorAgreement_memberId_version_key" ON "AggregatorAgreement"("memberId", "version");

-- CreateIndex
CREATE INDEX "AggregatorAgreement_memberId_status_idx" ON "AggregatorAgreement"("memberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatorEligibilityCheck_memberId_externalCheckId_key" ON "AggregatorEligibilityCheck"("memberId", "externalCheckId");

-- CreateIndex
CREATE INDEX "AggregatorEligibilityCheck_memberId_status_verifiedAt_idx" ON "AggregatorEligibilityCheck"("memberId", "status", "verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatorVisitAuthorization_memberId_externalVisitId_key" ON "AggregatorVisitAuthorization"("memberId", "externalVisitId");

-- CreateIndex
CREATE INDEX "AggregatorVisitAuthorization_memberId_status_requestedAt_idx" ON "AggregatorVisitAuthorization"("memberId", "status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatorAccessEventLink_visitAuthorizationId_key" ON "AggregatorAccessEventLink"("visitAuthorizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatorAccessEventLink_accessEventId_key" ON "AggregatorAccessEventLink"("accessEventId");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatorProvisionalDecision_visitAuthorizationId_key" ON "AggregatorProvisionalDecision"("visitAuthorizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatorRevalidationAttempt_visitAuthorizationId_attempt_key" ON "AggregatorRevalidationAttempt"("visitAuthorizationId", "attempt");

-- CreateIndex
CREATE INDEX "AggregatorRevalidationAttempt_status_attemptedAt_idx" ON "AggregatorRevalidationAttempt"("status", "attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatorSettlement_connectionId_externalSettlementId_key" ON "AggregatorSettlement"("connectionId", "externalSettlementId");

-- CreateIndex
CREATE INDEX "AggregatorSettlement_connectionId_status_idx" ON "AggregatorSettlement"("connectionId", "status");

-- CreateIndex
CREATE INDEX "AggregatorSettlement_visitAuthorizationId_idx" ON "AggregatorSettlement"("visitAuthorizationId");

-- CreateIndex
CREATE INDEX "AggregatorReconciliation_status_createdAt_idx" ON "AggregatorReconciliation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AggregatorReconciliation_visitAuthorizationId_idx" ON "AggregatorReconciliation"("visitAuthorizationId");

-- CreateIndex
CREATE INDEX "AggregatorReconciliation_settlementId_idx" ON "AggregatorReconciliation"("settlementId");

-- CreateIndex
CREATE INDEX "AggregatorRiskCase_connectionId_status_idx" ON "AggregatorRiskCase"("connectionId", "status");

-- CreateIndex
CREATE INDEX "AggregatorRiskCase_visitAuthorizationId_idx" ON "AggregatorRiskCase"("visitAuthorizationId");

-- AddForeignKey
ALTER TABLE "AggregatorProviderConnection" ADD CONSTRAINT "AggregatorProviderConnection_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorMember" ADD CONSTRAINT "AggregatorMember_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AggregatorProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorMember" ADD CONSTRAINT "AggregatorMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorMembership" ADD CONSTRAINT "AggregatorMembership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "AggregatorMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorAgreement" ADD CONSTRAINT "AggregatorAgreement_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "AggregatorMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorEligibilityCheck" ADD CONSTRAINT "AggregatorEligibilityCheck_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "AggregatorMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorEligibilityCheck" ADD CONSTRAINT "AggregatorEligibilityCheck_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "AggregatorMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorVisitAuthorization" ADD CONSTRAINT "AggregatorVisitAuthorization_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "AggregatorMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorVisitAuthorization" ADD CONSTRAINT "AggregatorVisitAuthorization_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "AggregatorAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorVisitAuthorization" ADD CONSTRAINT "AggregatorVisitAuthorization_eligibilityCheckId_fkey" FOREIGN KEY ("eligibilityCheckId") REFERENCES "AggregatorEligibilityCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorAccessEventLink" ADD CONSTRAINT "AggregatorAccessEventLink_visitAuthorizationId_fkey" FOREIGN KEY ("visitAuthorizationId") REFERENCES "AggregatorVisitAuthorization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorAccessEventLink" ADD CONSTRAINT "AggregatorAccessEventLink_accessEventId_fkey" FOREIGN KEY ("accessEventId") REFERENCES "AccessEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorProvisionalDecision" ADD CONSTRAINT "AggregatorProvisionalDecision_visitAuthorizationId_fkey" FOREIGN KEY ("visitAuthorizationId") REFERENCES "AggregatorVisitAuthorization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorRevalidationAttempt" ADD CONSTRAINT "AggregatorRevalidationAttempt_visitAuthorizationId_fkey" FOREIGN KEY ("visitAuthorizationId") REFERENCES "AggregatorVisitAuthorization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorSettlement" ADD CONSTRAINT "AggregatorSettlement_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AggregatorProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorSettlement" ADD CONSTRAINT "AggregatorSettlement_visitAuthorizationId_fkey" FOREIGN KEY ("visitAuthorizationId") REFERENCES "AggregatorVisitAuthorization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorReconciliation" ADD CONSTRAINT "AggregatorReconciliation_visitAuthorizationId_fkey" FOREIGN KEY ("visitAuthorizationId") REFERENCES "AggregatorVisitAuthorization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorReconciliation" ADD CONSTRAINT "AggregatorReconciliation_accessEventLinkId_fkey" FOREIGN KEY ("accessEventLinkId") REFERENCES "AggregatorAccessEventLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorReconciliation" ADD CONSTRAINT "AggregatorReconciliation_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "AggregatorSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorRiskCase" ADD CONSTRAINT "AggregatorRiskCase_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AggregatorProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorRiskCase" ADD CONSTRAINT "AggregatorRiskCase_visitAuthorizationId_fkey" FOREIGN KEY ("visitAuthorizationId") REFERENCES "AggregatorVisitAuthorization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorRiskCase" ADD CONSTRAINT "AggregatorRiskCase_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "AggregatorReconciliation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatorRiskCase" ADD CONSTRAINT "AggregatorRiskCase_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "AggregatorSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
