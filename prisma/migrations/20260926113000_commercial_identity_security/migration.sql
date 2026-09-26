-- IRON Block 4 — Commercial Identity & Security
-- Additive identity hardening. Keeps User/Session as canonical authorities.

CREATE TYPE "AuthActionTokenKind" AS ENUM (
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'EMAIL_CHANGE'
);
CREATE TYPE "AuthActionDeliveryStatus" AS ENUM (
  'PENDING',
  'DELIVERED',
  'FAILED'
);

ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

ALTER TABLE "Session"
  ADD COLUMN "previousRefreshTokenHash" TEXT,
  ADD COLUMN "absoluteExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "AuthActionToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "AuthActionTokenKind" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "deliveryCiphertext" TEXT NOT NULL,
  "deliveryStatus" "AuthActionDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "deliveredAt" TIMESTAMP(3),
  "targetEmail" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthActionToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthRateLimitBucket" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "blockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthRateLimitBucket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthRateLimitBucket_count_nonnegative" CHECK ("count" >= 0)
);

CREATE UNIQUE INDEX "AuthActionToken_tokenHash_key"
  ON "AuthActionToken"("tokenHash");
CREATE INDEX "AuthActionToken_userId_kind_consumedAt_idx"
  ON "AuthActionToken"("userId", "kind", "consumedAt");
CREATE INDEX "AuthActionToken_expiresAt_idx"
  ON "AuthActionToken"("expiresAt");

CREATE UNIQUE INDEX "AuthRecoveryCode_userId_codeHash_key"
  ON "AuthRecoveryCode"("userId", "codeHash");
CREATE INDEX "AuthRecoveryCode_userId_usedAt_idx"
  ON "AuthRecoveryCode"("userId", "usedAt");

CREATE UNIQUE INDEX "AuthRateLimitBucket_scope_keyHash_key"
  ON "AuthRateLimitBucket"("scope", "keyHash");
CREATE INDEX "AuthRateLimitBucket_blockedUntil_idx"
  ON "AuthRateLimitBucket"("blockedUntil");

ALTER TABLE "AuthActionToken"
  ADD CONSTRAINT "AuthActionToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuthRecoveryCode"
  ADD CONSTRAINT "AuthRecoveryCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
