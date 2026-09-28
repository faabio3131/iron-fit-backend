-- IRON Macro L — LGPD/legal operational governance core.
-- This migration creates workflow/governance records only.
-- It does not assert legal approval, statutory deadlines, legal bases, or subprocessor approval.

CREATE TYPE "DataSubjectRequestType" AS ENUM (
  'ACCESS',
  'CORRECTION',
  'DELETION',
  'PORTABILITY',
  'RESTRICTION',
  'OBJECTION'
);

CREATE TYPE "DataSubjectRequestStatus" AS ENUM (
  'OPEN',
  'IN_REVIEW',
  'FULFILLED',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE "LegalDocumentKind" AS ENUM (
  'PRIVACY_POLICY',
  'TERMS_OF_SERVICE'
);

CREATE TYPE "LegalDocumentStatus" AS ENUM (
  'DRAFT',
  'APPROVED',
  'RETIRED'
);

CREATE TYPE "RetentionAction" AS ENUM (
  'DELETE',
  'ANONYMIZE',
  'REVIEW'
);

CREATE TYPE "GovernanceRecordStatus" AS ENUM (
  'DRAFT',
  'APPROVED',
  'RETIRED'
);

CREATE TABLE "DataSubjectRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "DataSubjectRequestType" NOT NULL,
  "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'OPEN',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "operationalDueAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "resolutionCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalDocument" (
  "id" TEXT NOT NULL,
  "kind" "LegalDocumentKind" NOT NULL,
  "version" TEXT NOT NULL,
  "status" "LegalDocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "contentUrl" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalAcceptance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "legalDocumentId" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataRetentionPolicy" (
  "id" TEXT NOT NULL,
  "dataClass" TEXT NOT NULL,
  "purposeCode" TEXT NOT NULL,
  "legalBasisCode" TEXT NOT NULL,
  "retentionDays" INTEGER,
  "action" "RetentionAction" NOT NULL,
  "status" "GovernanceRecordStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DataRetentionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubprocessorRecord" (
  "id" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "purposeCode" TEXT NOT NULL,
  "dataCategories" JSONB NOT NULL,
  "processingRegion" TEXT,
  "privacyUrl" TEXT,
  "dpaReference" TEXT,
  "status" "GovernanceRecordStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SubprocessorRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalDocument_kind_version_key"
  ON "LegalDocument"("kind", "version");

CREATE UNIQUE INDEX "LegalAcceptance_userId_legalDocumentId_key"
  ON "LegalAcceptance"("userId", "legalDocumentId");

CREATE UNIQUE INDEX "DataRetentionPolicy_dataClass_key"
  ON "DataRetentionPolicy"("dataClass");

CREATE UNIQUE INDEX "SubprocessorRecord_providerCode_key"
  ON "SubprocessorRecord"("providerCode");

CREATE INDEX "DataSubjectRequest_userId_status_requestedAt_idx"
  ON "DataSubjectRequest"("userId", "status", "requestedAt");

CREATE INDEX "DataSubjectRequest_status_operationalDueAt_idx"
  ON "DataSubjectRequest"("status", "operationalDueAt");

CREATE INDEX "LegalDocument_kind_status_effectiveAt_idx"
  ON "LegalDocument"("kind", "status", "effectiveAt");

CREATE INDEX "LegalAcceptance_userId_acceptedAt_idx"
  ON "LegalAcceptance"("userId", "acceptedAt");

CREATE INDEX "DataRetentionPolicy_status_dataClass_idx"
  ON "DataRetentionPolicy"("status", "dataClass");

CREATE INDEX "SubprocessorRecord_status_providerCode_idx"
  ON "SubprocessorRecord"("status", "providerCode");

ALTER TABLE "DataSubjectRequest"
  ADD CONSTRAINT "DataSubjectRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalAcceptance"
  ADD CONSTRAINT "LegalAcceptance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalAcceptance"
  ADD CONSTRAINT "LegalAcceptance_legalDocumentId_fkey"
  FOREIGN KEY ("legalDocumentId") REFERENCES "LegalDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
