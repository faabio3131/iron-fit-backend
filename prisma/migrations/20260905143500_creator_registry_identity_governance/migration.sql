CREATE TYPE "CreatorStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'RETIRED');

CREATE TYPE "CreatorIdentityStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REVOKED');

CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "status" "CreatorStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorIdentity" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "externalSubject" TEXT NOT NULL,
    "handle" TEXT,
    "profileUrl" TEXT,
    "status" "CreatorIdentityStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Creator_slug_key" ON "Creator"("slug");
CREATE INDEX "Creator_status_displayName_idx" ON "Creator"("status", "displayName");

CREATE UNIQUE INDEX "CreatorIdentity_providerCode_externalSubject_key"
ON "CreatorIdentity"("providerCode", "externalSubject");
CREATE INDEX "CreatorIdentity_creatorId_status_idx"
ON "CreatorIdentity"("creatorId", "status");
CREATE INDEX "CreatorIdentity_providerCode_handle_idx"
ON "CreatorIdentity"("providerCode", "handle");

ALTER TABLE "CreatorIdentity"
ADD CONSTRAINT "CreatorIdentity_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "Creator"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
