-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('SUPER_ADMIN', 'OWNER', 'MANAGER', 'RECEPTION', 'TRAINER', 'STUDENT');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "WorkoutStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('SCHEDULED', 'CHECKED_IN', 'NO_SHOW', 'CANCELED');

-- CreateEnum
CREATE TYPE "AccessType" AS ENUM ('QR_CODE', 'BIOMETRIC', 'FACIAL', 'TAG', 'MANUAL');

-- CreateEnum
CREATE TYPE "GatewayProvider" AS ENUM ('ASAAS', 'MERCADO_PAGO', 'PAGARME', 'STRIPE', 'EFI', 'GERENCIANET', 'IUGU', 'VINDI', 'MANUAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PLANNED', 'PENDING', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('PUSH', 'IN_APP', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceName" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "gymId" TEXT,
    "assignedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "gymId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "previous" JSONB,
    "next" JSONB,
    "ipAddress" TEXT,
    "deviceInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gym" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "userId" TEXT,
    "birthDate" TIMESTAMP(3),
    "gender" TEXT,
    "goal" TEXT,
    "level" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrollmentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consentHealth" BOOLEAN NOT NULL DEFAULT false,
    "consentComm" BOOLEAN NOT NULL DEFAULT false,
    "consentBiometry" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "evaluatorId" TEXT,
    "weight" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "bmi" DOUBLE PRECISION,
    "bodyFatPercent" DOUBLE PRECISION,
    "measurements" JSONB,
    "restrictions" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "standardName" TEXT,
    "type" TEXT,
    "primaryMuscle" TEXT,
    "secondaryMuscles" JSONB,
    "movementPattern" TEXT,
    "difficulty" TEXT,
    "contraindications" JSONB,
    "videoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "muscleGroup" TEXT,
    "movement" TEXT,
    "level" TEXT,
    "videoUrl" TEXT,
    "contraindications" JSONB,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workout" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assessmentId" TEXT,
    "createdByAI" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "status" "WorkoutStatus" NOT NULL DEFAULT 'DRAFT',
    "goal" TEXT,
    "level" TEXT,
    "weeklyFrequency" INTEGER,
    "startDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSession" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sessionType" TEXT,
    "order" INTEGER NOT NULL,
    "estimatedMinutes" INTEGER,

    CONSTRAINT "WorkoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutExercise" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "equipmentId" TEXT,
    "order" INTEGER NOT NULL,
    "sets" INTEGER,
    "reps" TEXT,
    "restSeconds" INTEGER,
    "suggestedLoad" TEXT,
    "notes" TEXT,

    CONSTRAINT "WorkoutExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleSlot" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ScheduleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentSchedule" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "checkedInAt" TIMESTAMP(3),

    CONSTRAINT "StudentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessDevice" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccessType" NOT NULL,
    "protocol" TEXT,
    "ipAddress" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),

    CONSTRAINT "AccessDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessCredential" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "AccessType" NOT NULL,
    "tokenHash" TEXT,
    "biometricHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AccessCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessEvent" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "studentId" TEXT,
    "deviceId" TEXT,
    "allowed" BOOLEAN NOT NULL,
    "denialReason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProfile" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "tradeName" TEXT,
    "taxID" TEXT,
    "responsibleName" TEXT,
    "responsibleEmail" TEXT,
    "responsiblePhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "FinancialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayConnection" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "provider" "GatewayProvider" NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'sandbox',
    "authType" TEXT NOT NULL,
    "merchantId" TEXT,
    "accountId" TEXT,
    "apiKeyEnc" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "webhookSecretEnc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "lastVerifiedAt" TIMESTAMP(3),

    CONSTRAINT "GatewayConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAccount" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "initialBalance" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialCategory" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "color" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FinancialCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialTransaction" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "categoryId" TEXT,
    "accountId" TEXT,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT,
    "sourceId" TEXT,
    "studentId" TEXT,
    "supplierId" TEXT,
    "paymentMethod" TEXT,
    "receiptUrl" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxID" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payable" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "supplierId" TEXT,
    "categoryId" TEXT,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "attachmentUrl" TEXT,

    CONSTRAINT "Payable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "gatewaySubId" TEXT,
    "nextBillingAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "gatewayChargeId" TEXT,
    "amount" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT,
    "pixQrCode" TEXT,
    "paymentLink" TEXT,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationTemplate" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "variables" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CommunicationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationAutomation" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerEvent" TEXT NOT NULL,
    "conditions" JSONB,
    "actions" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CommunicationAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMessage" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "templateId" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "title" TEXT,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationPreference" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "trainingReminders" BOOLEAN NOT NULL DEFAULT true,
    "paymentReminders" BOOLEAN NOT NULL DEFAULT true,
    "marketing" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CommunicationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");

-- CreateIndex
CREATE INDEX "AuditLog_gymId_idx" ON "AuditLog"("gymId");

-- CreateIndex
CREATE UNIQUE INDEX "Gym_slug_key" ON "Gym"("slug");

-- CreateIndex
CREATE INDEX "Gym_slug_idx" ON "Gym"("slug");

-- CreateIndex
CREATE INDEX "Student_gymId_idx" ON "Student"("gymId");

-- CreateIndex
CREATE INDEX "Assessment_studentId_idx" ON "Assessment"("studentId");

-- CreateIndex
CREATE INDEX "Equipment_gymId_idx" ON "Equipment"("gymId");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_name_key" ON "Exercise"("name");

-- CreateIndex
CREATE INDEX "Workout_studentId_idx" ON "Workout"("studentId");

-- CreateIndex
CREATE INDEX "ScheduleSlot_gymId_idx" ON "ScheduleSlot"("gymId");

-- CreateIndex
CREATE INDEX "StudentSchedule_studentId_idx" ON "StudentSchedule"("studentId");

-- CreateIndex
CREATE INDEX "AccessCredential_studentId_idx" ON "AccessCredential"("studentId");

-- CreateIndex
CREATE INDEX "AccessEvent_gymId_idx" ON "AccessEvent"("gymId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProfile_gymId_key" ON "FinancialProfile"("gymId");

-- CreateIndex
CREATE INDEX "FinancialTransaction_gymId_idx" ON "FinancialTransaction"("gymId");

-- CreateIndex
CREATE INDEX "Payable_gymId_idx" ON "Payable"("gymId");

-- CreateIndex
CREATE INDEX "Subscription_gymId_idx" ON "Subscription"("gymId");

-- CreateIndex
CREATE INDEX "Charge_gymId_idx" ON "Charge"("gymId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_studentId_idx" ON "CommunicationMessage"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationPreference_studentId_key" ON "CommunicationPreference"("studentId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSchedule" ADD CONSTRAINT "StudentSchedule_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSchedule" ADD CONSTRAINT "StudentSchedule_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ScheduleSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessDevice" ADD CONSTRAINT "AccessDevice_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCredential" ADD CONSTRAINT "AccessCredential_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AccessDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProfile" ADD CONSTRAINT "FinancialProfile_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayConnection" ADD CONSTRAINT "GatewayConnection_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "FinancialProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialCategory" ADD CONSTRAINT "FinancialCategory_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationTemplate" ADD CONSTRAINT "CommunicationTemplate_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationAutomation" ADD CONSTRAINT "CommunicationAutomation_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CommunicationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationPreference" ADD CONSTRAINT "CommunicationPreference_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
