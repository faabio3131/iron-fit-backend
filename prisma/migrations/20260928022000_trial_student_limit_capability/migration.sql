-- IRON Commercial Readiness — enforceable trial student cap.
-- Adds a runtime capability used only by trial ProductPlan versions.

INSERT INTO "ProductCapabilityDefinition"
  ("key", "kind", "domain", "description", "allowedPolicyValues", "status", "updatedAt")
VALUES
  (
    'commercial.trial_students_max',
    'LIMIT',
    'CORE',
    'Limite maximo de alunos nao cancelados durante o trial comercial do IRON.',
    NULL,
    'ACTIVE',
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO NOTHING;
