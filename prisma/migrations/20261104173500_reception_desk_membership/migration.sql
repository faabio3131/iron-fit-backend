-- AlterTable
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "cpf" TEXT,
ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "MembershipPlan" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "intervalMonths" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReceptionDeskPolicy" (
    "gymId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceptionDeskPolicy_pkey" PRIMARY KEY ("gymId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeskReceipt" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "planId" TEXT,
    "subscriptionId" TEXT,
    "chargeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeskReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MembershipPlan_gymId_active_idx" ON "MembershipPlan"("gymId", "active");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DeskReceipt_chargeId_key" ON "DeskReceipt"("chargeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeskReceipt_gymId_actorUserId_createdAt_idx" ON "DeskReceipt"("gymId", "actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DeskReceipt_gymId_requestId_key" ON "DeskReceipt"("gymId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Student_gymId_cpf_key" ON "Student"("gymId", "cpf");

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MembershipPlan_gymId_fkey') THEN ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReceptionDeskPolicy_gymId_fkey') THEN ALTER TABLE "ReceptionDeskPolicy" ADD CONSTRAINT "ReceptionDeskPolicy_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReceptionDeskPolicy_accountId_fkey') THEN ALTER TABLE "ReceptionDeskPolicy" ADD CONSTRAINT "ReceptionDeskPolicy_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeskReceipt_gymId_fkey') THEN ALTER TABLE "DeskReceipt" ADD CONSTRAINT "DeskReceipt_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeskReceipt_studentId_fkey') THEN ALTER TABLE "DeskReceipt" ADD CONSTRAINT "DeskReceipt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeskReceipt_planId_fkey') THEN ALTER TABLE "DeskReceipt" ADD CONSTRAINT "DeskReceipt_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeskReceipt_subscriptionId_fkey') THEN ALTER TABLE "DeskReceipt" ADD CONSTRAINT "DeskReceipt_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeskReceipt_chargeId_fkey') THEN ALTER TABLE "DeskReceipt" ADD CONSTRAINT "DeskReceipt_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;


DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MembershipPlan_amount_positive') THEN
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_amount_positive" CHECK ("amount" > 0 AND "intervalMonths" IN (1,3,6,12));
END IF; END $$;
