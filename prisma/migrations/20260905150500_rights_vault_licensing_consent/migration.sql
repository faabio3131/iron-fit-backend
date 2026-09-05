CREATE TYPE "CreatorRightsScope" AS ENUM ('GLOBAL', 'TENANT');
CREATE TYPE "CreatorRightsHolderKind" AS ENUM ('CREATOR', 'PERSON', 'ORGANIZATION', 'TENANT');
CREATE TYPE "CreatorRightsHolderStatus" AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE "CreatorManagedRelationKind" AS ENUM ('LICENSED_CONTENT', 'IRON_OWNED', 'TENANT_OWNED');
CREATE TYPE "CreatorRightsBasisKind" AS ENUM ('LICENSE', 'ASSIGNMENT', 'CONSENT', 'OWNERSHIP_ATTESTATION', 'OTHER');
CREATE TYPE "CreatorRightsGrantStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'SUSPENDED', 'REVOKED');
CREATE TYPE "CreatorRightsConsentKind" AS ENUM ('CONTENT_USE', 'LIKENESS', 'VOICE', 'PERFORMANCE', 'OTHER');
CREATE TYPE "CreatorRightsConsentStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REVOKED');

CREATE TABLE "CreatorRightsHolder" (
    "id" TEXT NOT NULL,
    "scope" "CreatorRightsScope" NOT NULL,
    "gymId" TEXT,
    "kind" "CreatorRightsHolderKind" NOT NULL,
    "creatorId" TEXT,
    "legalName" TEXT NOT NULL,
    "externalReference" TEXT,
    "fingerprint" TEXT NOT NULL,
    "status" "CreatorRightsHolderStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorRightsHolder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreatorRightsHolder_scope_gym_check" CHECK (
      ("scope" = 'GLOBAL' AND "gymId" IS NULL)
      OR ("scope" = 'TENANT' AND "gymId" IS NOT NULL)
    ),
    CONSTRAINT "CreatorRightsHolder_creator_kind_check" CHECK (
      ("kind" = 'CREATOR' AND "creatorId" IS NOT NULL)
      OR ("kind" <> 'CREATOR' AND "creatorId" IS NULL)
    ),
    CONSTRAINT "CreatorRightsHolder_tenant_kind_scope_check" CHECK (
      "kind" <> 'TENANT' OR "scope" = 'TENANT'
    )
);

CREATE TABLE "CreatorRightsGrant" (
    "id" TEXT NOT NULL,
    "scope" "CreatorRightsScope" NOT NULL,
    "gymId" TEXT,
    "relationKind" "CreatorManagedRelationKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorRightsGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreatorRightsGrant_scope_gym_check" CHECK (
      ("scope" = 'GLOBAL' AND "gymId" IS NULL)
      OR ("scope" = 'TENANT' AND "gymId" IS NOT NULL)
    ),
    CONSTRAINT "CreatorRightsGrant_relation_scope_check" CHECK (
      ("scope" = 'TENANT' AND "relationKind" = 'TENANT_OWNED')
      OR ("scope" = 'GLOBAL' AND "relationKind" <> 'TENANT_OWNED')
    )
);

CREATE TABLE "CreatorRightsGrantVersion" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rightsHolderId" TEXT NOT NULL,
    "basisKind" "CreatorRightsBasisKind" NOT NULL,
    "status" "CreatorRightsGrantStatus" NOT NULL DEFAULT 'DRAFT',
    "usageScopes" TEXT[] NOT NULL,
    "deliveryScopes" TEXT[] NOT NULL,
    "territories" TEXT[] NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "attributionRequired" BOOLEAN NOT NULL DEFAULT false,
    "attributionText" TEXT,
    "evidenceReference" TEXT NOT NULL,
    "evidenceSha256" TEXT NOT NULL,
    "termsSha256" TEXT,
    "requiresCreatorConsent" BOOLEAN NOT NULL DEFAULT false,
    "fingerprint" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorRightsGrantVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreatorRightsGrantVersion_positive_version_check" CHECK ("version" > 0),
    CONSTRAINT "CreatorRightsGrantVersion_usage_scope_check" CHECK (cardinality("usageScopes") > 0),
    CONSTRAINT "CreatorRightsGrantVersion_delivery_scope_check" CHECK (cardinality("deliveryScopes") > 0),
    CONSTRAINT "CreatorRightsGrantVersion_territory_check" CHECK (cardinality("territories") > 0),
    CONSTRAINT "CreatorRightsGrantVersion_validity_check" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom"),
    CONSTRAINT "CreatorRightsGrantVersion_evidence_hash_check" CHECK ("evidenceSha256" ~ '^[0-9A-Fa-f]{64}$'),
    CONSTRAINT "CreatorRightsGrantVersion_terms_hash_check" CHECK ("termsSha256" IS NULL OR "termsSha256" ~ '^[0-9A-Fa-f]{64}$'),
    CONSTRAINT "CreatorRightsGrantVersion_attribution_check" CHECK (
      NOT "attributionRequired" OR ("attributionText" IS NOT NULL AND length(trim("attributionText")) > 0)
    )
);

CREATE TABLE "CreatorRightsConsent" (
    "id" TEXT NOT NULL,
    "grantVersionId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "kind" "CreatorRightsConsentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "CreatorRightsConsentStatus" NOT NULL DEFAULT 'ACTIVE',
    "purposeScopes" TEXT[] NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "evidenceReference" TEXT NOT NULL,
    "evidenceSha256" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorRightsConsent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreatorRightsConsent_positive_version_check" CHECK ("version" > 0),
    CONSTRAINT "CreatorRightsConsent_purpose_scope_check" CHECK (cardinality("purposeScopes") > 0),
    CONSTRAINT "CreatorRightsConsent_validity_check" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom"),
    CONSTRAINT "CreatorRightsConsent_evidence_hash_check" CHECK ("evidenceSha256" ~ '^[0-9A-Fa-f]{64}$')
);

CREATE UNIQUE INDEX "CreatorRightsHolder_fingerprint_key" ON "CreatorRightsHolder"("fingerprint");
CREATE INDEX "CreatorRightsHolder_scope_gymId_status_idx" ON "CreatorRightsHolder"("scope", "gymId", "status");
CREATE INDEX "CreatorRightsHolder_creatorId_status_idx" ON "CreatorRightsHolder"("creatorId", "status");

CREATE INDEX "CreatorRightsGrant_scope_gymId_relationKind_idx" ON "CreatorRightsGrant"("scope", "gymId", "relationKind");

CREATE UNIQUE INDEX "CreatorRightsGrantVersion_fingerprint_key" ON "CreatorRightsGrantVersion"("fingerprint");
CREATE UNIQUE INDEX "CreatorRightsGrantVersion_grantId_version_key" ON "CreatorRightsGrantVersion"("grantId", "version");
CREATE UNIQUE INDEX "CreatorRightsGrantVersion_one_active_per_grant_key"
ON "CreatorRightsGrantVersion"("grantId") WHERE "status" = 'ACTIVE';
CREATE INDEX "CreatorRightsGrantVersion_grantId_status_idx" ON "CreatorRightsGrantVersion"("grantId", "status");
CREATE INDEX "CreatorRightsGrantVersion_rightsHolderId_status_idx" ON "CreatorRightsGrantVersion"("rightsHolderId", "status");

CREATE UNIQUE INDEX "CreatorRightsConsent_fingerprint_key" ON "CreatorRightsConsent"("fingerprint");
CREATE UNIQUE INDEX "CreatorRightsConsent_grantVersionId_creatorId_kind_version_key"
ON "CreatorRightsConsent"("grantVersionId", "creatorId", "kind", "version");
CREATE UNIQUE INDEX "CreatorRightsConsent_one_active_per_subject_kind_key"
ON "CreatorRightsConsent"("grantVersionId", "creatorId", "kind") WHERE "status" = 'ACTIVE';
CREATE INDEX "CreatorRightsConsent_grantVersionId_status_idx" ON "CreatorRightsConsent"("grantVersionId", "status");
CREATE INDEX "CreatorRightsConsent_creatorId_status_idx" ON "CreatorRightsConsent"("creatorId", "status");

ALTER TABLE "CreatorRightsHolder"
ADD CONSTRAINT "CreatorRightsHolder_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "Creator"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorRightsGrantVersion"
ADD CONSTRAINT "CreatorRightsGrantVersion_grantId_fkey"
FOREIGN KEY ("grantId") REFERENCES "CreatorRightsGrant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorRightsGrantVersion"
ADD CONSTRAINT "CreatorRightsGrantVersion_rightsHolderId_fkey"
FOREIGN KEY ("rightsHolderId") REFERENCES "CreatorRightsHolder"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorRightsConsent"
ADD CONSTRAINT "CreatorRightsConsent_grantVersionId_fkey"
FOREIGN KEY ("grantVersionId") REFERENCES "CreatorRightsGrantVersion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorRightsConsent"
ADD CONSTRAINT "CreatorRightsConsent_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "Creator"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
