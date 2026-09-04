-- S12 certification blocker: enforce canonical financial source idempotency at DB level.
-- Fail closed if legacy duplicate canonical source identities exist; do not rewrite financial history silently.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "FinancialTransaction"
    WHERE "source" IS NOT NULL
      AND "sourceId" IS NOT NULL
    GROUP BY "gymId", "source", "sourceId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate FinancialTransaction source identities detected; reconcile before applying S12 unique constraint';
  END IF;
END $$;

CREATE UNIQUE INDEX "FinancialTransaction_gymId_source_sourceId_key"
ON "FinancialTransaction"("gymId", "source", "sourceId");
