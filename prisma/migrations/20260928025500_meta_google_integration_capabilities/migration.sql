-- IRON Commercial Readiness — Meta/Google tenant integration authorities.
-- Adds configurable product capabilities used to authorize tenant-level provider credentials.

INSERT INTO "ProductCapabilityDefinition"
  ("key", "kind", "domain", "description", "allowedPolicyValues", "status", "updatedAt")
VALUES
  (
    'integration.meta',
    'FEATURE',
    'INTEGRATION',
    'Autoriza configuracao tenant do provider Meta, cobrindo Facebook, Instagram e WhatsApp conforme capabilities tecnicas habilitadas.',
    NULL,
    'ACTIVE',
    CURRENT_TIMESTAMP
  ),
  (
    'integration.google',
    'FEATURE',
    'INTEGRATION',
    'Autoriza configuracao tenant do provider Google por OAuth/configuracao governada.',
    NULL,
    'ACTIVE',
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO NOTHING;
