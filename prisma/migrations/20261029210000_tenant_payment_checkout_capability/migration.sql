-- Canonical tenant capability for academy-owned payment checkout.
-- Does not modify existing published plan versions or subscriptions.
INSERT INTO "ProductCapabilityDefinition"
  ("key", "kind", "domain", "description", "allowedPolicyValues", "status", "updatedAt")
VALUES
  (
    'billing.student.checkout',
    'FEATURE',
    'FINANCIAL',
    'Autoriza conexoes de gateway da academia para cobranca de alunos, conforme isolamento tenant e homologacao do provider.',
    NULL,
    'ACTIVE',
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO NOTHING;
