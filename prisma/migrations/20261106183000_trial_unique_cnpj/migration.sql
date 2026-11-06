ALTER TABLE "CommercialTrialProvisioning" ADD COLUMN IF NOT EXISTS "cnpj" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "CommercialTrialProvisioning_cnpj_key" ON "CommercialTrialProvisioning"("cnpj");
