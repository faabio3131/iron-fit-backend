-- IRON Macro L1/L2 — LGPD data subject request intake.
-- This migration creates an auditable request ledger only.
-- It does not define legal retention periods or enable automatic deletion.

CREATE TYPE "DataSubjectRequestType" AS ENUM (
  'TREATMENT_CONFIRMATION',
  'ACCESS',
  'CORRECTION',
  'PORTABILITY',
  'DELETION',
  'OBJECTION',
  'CONSENT_REVOCATION'
);

CREATE TYPE "DataSubjectRequestStatus" AS ENUM (
  'RECEIVED',
  'IDENTITY_VERIFICATION',
  'IN_REVIEW',
  'FULFILLED',
  'DENIED',
  'CANCELLED'
);

CREATE TABLE "DataSubjectRequest" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "subjectUserId" TEXT NOT NULL,
  "requestType" "DataSubjectRequestType" NOT NULL,
  "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "identityVerifiedAt" TIMESTAMP(3),
  "resolutionCode" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataSubjectRequest_requestId_key"
  ON "DataSubjectRequest"("requestId");

CREATE INDEX "DataSubjectRequest_gymId_status_createdAt_idx"
  ON "DataSubjectRequest"("gymId", "status", "createdAt");

CREATE INDEX "DataSubjectRequest_subjectUserId_createdAt_idx"
  ON "DataSubjectRequest"("subjectUserId", "createdAt");

ALTER TABLE "DataSubjectRequest"
  ADD CONSTRAINT "DataSubjectRequest_gymId_fkey"
  FOREIGN KEY ("gymId") REFERENCES "Gym"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DataSubjectRequest"
  ADD CONSTRAINT "DataSubjectRequest_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
