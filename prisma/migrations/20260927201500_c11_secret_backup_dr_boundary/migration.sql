-- IRON Commercial Readiness C11 — Backup/DR Secret Policy.
--
-- Legacy GatewayConnection credential columns violate the new Integration & Secret
-- Vault contract because PostgreSQL backups would carry provider credential material.
-- This migration NEVER silently destroys populated legacy credentials.
-- If any legacy column is populated, deployment stops and an operator must first
-- externalize that credential into the governed IntegrationConnection + Vault flow.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "GatewayConnection"
    WHERE "apiKeyEnc" IS NOT NULL
       OR "accessTokenEnc" IS NOT NULL
       OR "refreshTokenEnc" IS NOT NULL
       OR "webhookSecretEnc" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'C11 blocked: legacy GatewayConnection credentials must be externalized to Integration Secret Vault before migration';
  END IF;
END
$$;

ALTER TABLE "GatewayConnection"
  DROP COLUMN IF EXISTS "apiKeyEnc",
  DROP COLUMN IF EXISTS "accessTokenEnc",
  DROP COLUMN IF EXISTS "refreshTokenEnc",
  DROP COLUMN IF EXISTS "webhookSecretEnc";
