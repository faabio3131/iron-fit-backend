CREATE TYPE "ManagerAlertCategory" AS ENUM ('STUDENT_BILLING', 'ATTENDANCE_RISK', 'ASSESSMENT_WORKOUT', 'EQUIPMENT', 'DELIVERY_FAILURE', 'INTEGRATION_HEALTH', 'PLAN_LIMIT', 'SECURITY', 'OPERATIONAL_INCIDENT', 'HUMAN_APPROVAL');
CREATE TYPE "ManagerAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "ManagerAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');
CREATE TYPE "ManagerAlertChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH', 'WHATSAPP');
CREATE TYPE "ManagerAlertDeliveryStatus" AS ENUM ('PENDING', 'DEFERRED', 'SENDING', 'SENT', 'FAILED', 'DEAD_LETTER', 'SKIPPED');

CREATE TABLE "ManagerAlert" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "category" "ManagerAlertCategory" NOT NULL,
  "severity" "ManagerAlertSeverity" NOT NULL,
  "status" "ManagerAlertStatus" NOT NULL DEFAULT 'OPEN',
  "eventKey" TEXT NOT NULL,
  "deduplicationKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "dismissedAt" TIMESTAMP(3),
  "dismissedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagerAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagerAlertRecipient" (
  "id" TEXT NOT NULL,
  "alertId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleSnapshot" "RoleName" NOT NULL,
  "readAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagerAlertRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagerAlertPreference" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" "ManagerAlertCategory" NOT NULL,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
  "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
  "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
  "minimumSeverity" "ManagerAlertSeverity" NOT NULL DEFAULT 'INFO',
  "quietHoursStart" TEXT,
  "quietHoursEnd" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagerAlertPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagerAlertDelivery" (
  "id" TEXT NOT NULL,
  "alertId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "channel" "ManagerAlertChannel" NOT NULL,
  "status" "ManagerAlertDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "providerCode" TEXT,
  "providerMessageRef" TEXT,
  "lastErrorCode" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagerAlertDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagerAlert_gymId_deduplicationKey_key" ON "ManagerAlert"("gymId", "deduplicationKey");
CREATE INDEX "ManagerAlert_gymId_status_severity_createdAt_idx" ON "ManagerAlert"("gymId", "status", "severity", "createdAt");
CREATE INDEX "ManagerAlert_gymId_category_occurredAt_idx" ON "ManagerAlert"("gymId", "category", "occurredAt");
CREATE INDEX "ManagerAlert_resourceType_resourceId_idx" ON "ManagerAlert"("resourceType", "resourceId");
CREATE UNIQUE INDEX "ManagerAlertRecipient_alertId_userId_key" ON "ManagerAlertRecipient"("alertId", "userId");
CREATE INDEX "ManagerAlertRecipient_userId_readAt_createdAt_idx" ON "ManagerAlertRecipient"("userId", "readAt", "createdAt");
CREATE UNIQUE INDEX "ManagerAlertPreference_gymId_userId_category_key" ON "ManagerAlertPreference"("gymId", "userId", "category");
CREATE INDEX "ManagerAlertPreference_gymId_category_idx" ON "ManagerAlertPreference"("gymId", "category");
CREATE UNIQUE INDEX "ManagerAlertDelivery_idempotencyKey_key" ON "ManagerAlertDelivery"("idempotencyKey");
CREATE UNIQUE INDEX "ManagerAlertDelivery_recipientId_channel_key" ON "ManagerAlertDelivery"("recipientId", "channel");
CREATE INDEX "ManagerAlertDelivery_status_nextAttemptAt_idx" ON "ManagerAlertDelivery"("status", "nextAttemptAt");
CREATE INDEX "ManagerAlertDelivery_leaseUntil_idx" ON "ManagerAlertDelivery"("leaseUntil");
CREATE INDEX "ManagerAlertDelivery_alertId_channel_idx" ON "ManagerAlertDelivery"("alertId", "channel");

ALTER TABLE "ManagerAlert" ADD CONSTRAINT "ManagerAlert_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagerAlertRecipient" ADD CONSTRAINT "ManagerAlertRecipient_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "ManagerAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagerAlertRecipient" ADD CONSTRAINT "ManagerAlertRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagerAlertPreference" ADD CONSTRAINT "ManagerAlertPreference_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagerAlertPreference" ADD CONSTRAINT "ManagerAlertPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagerAlertDelivery" ADD CONSTRAINT "ManagerAlertDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "ManagerAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagerAlertDelivery" ADD CONSTRAINT "ManagerAlertDelivery_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "ManagerAlertRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
