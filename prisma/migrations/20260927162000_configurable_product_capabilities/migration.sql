-- IRON Commercial Readiness — configurable Product Capability Catalog.
-- Commercial capability authority moves from TypeScript constants to PostgreSQL.
-- Existing certified capabilities are bootstrapped as data; future capabilities require no code edit.

CREATE TYPE "ProductCapabilityStatus" AS ENUM ('ACTIVE', 'RETIRED');

CREATE TABLE "ProductCapabilityDefinition" (
  "key" TEXT NOT NULL,
  "kind" "ProductEntitlementKind" NOT NULL,
  "domain" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "allowedPolicyValues" JSONB,
  "status" "ProductCapabilityStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductCapabilityDefinition_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "ProductCapabilityDefinition_key_shape" CHECK (
    "key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
  ),
  CONSTRAINT "ProductCapabilityDefinition_domain_shape" CHECK (
    "domain" ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  CONSTRAINT "ProductCapabilityDefinition_description_nonempty" CHECK (
    length(btrim("description")) > 0
  ),
  CONSTRAINT "ProductCapabilityDefinition_policy_shape" CHECK (
    (
      "kind" = 'POLICY'
      AND "allowedPolicyValues" IS NOT NULL
      AND jsonb_typeof("allowedPolicyValues") = 'array'
      AND jsonb_array_length("allowedPolicyValues") > 0
    )
    OR
    (
      "kind" <> 'POLICY'
      AND "allowedPolicyValues" IS NULL
    )
  )
);

CREATE INDEX "ProductCapabilityDefinition_status_domain_idx"
  ON "ProductCapabilityDefinition"("status", "domain");
CREATE INDEX "ProductCapabilityDefinition_kind_status_idx"
  ON "ProductCapabilityDefinition"("kind", "status");

INSERT INTO "ProductCapabilityDefinition"
  ("key", "kind", "domain", "description", "allowedPolicyValues", "status", "updatedAt")
VALUES
  ('content.external_youtube', 'FEATURE', 'CONTENT', 'Permite entrega por referencia externa publica do YouTube.', NULL, 'ACTIVE', CURRENT_TIMESTAMP),
  ('content.iron_managed', 'FEATURE', 'CONTENT', 'Permite conteudo de midia gerenciado pelo IRON.', NULL, 'ACTIVE', CURRENT_TIMESTAMP),
  ('content.tenant_private', 'FEATURE', 'CONTENT', 'Permite conteudo privado pertencente ao tenant.', NULL, 'ACTIVE', CURRENT_TIMESTAMP),
  ('content.private_items_max', 'LIMIT', 'CONTENT', 'Limite superior de itens privados de conteudo disponibilizados ao tenant.', NULL, 'ACTIVE', CURRENT_TIMESTAMP),
  ('content.delivery_mode', 'POLICY', 'CONTENT', 'Modos de entrega autorizados para configuracao do tenant.', '["YOUTUBE_EXTERNAL","IRON_FIRST","TENANT_PRIVATE_FIRST","IRON_ONLY","YOUTUBE_ONLY"]'::jsonb, 'ACTIVE', CURRENT_TIMESTAMP),
  ('equipment.catalog', 'FEATURE', 'EQUIPMENT', 'Permite acesso ao catalogo canonico de equipamentos IRON.', NULL, 'ACTIVE', CURRENT_TIMESTAMP),
  ('equipment.inventory', 'FEATURE', 'EQUIPMENT', 'Permite ao tenant manter inventario derivado do catalogo.', NULL, 'ACTIVE', CURRENT_TIMESTAMP),
  ('aggregator.wellhub', 'FEATURE', 'AGGREGATOR', 'Permite capacidade Wellhub quando a integracao estiver homologada.', NULL, 'ACTIVE', CURRENT_TIMESTAMP),
  ('aggregator.totalpass', 'FEATURE', 'AGGREGATOR', 'Permite capacidade TotalPass quando a integracao estiver homologada.', NULL, 'ACTIVE', CURRENT_TIMESTAMP),
  ('analytics.aggregator', 'FEATURE', 'ANALYTICS', 'Permite analytics gerenciais do Aggregator Hub.', NULL, 'ACTIVE', CURRENT_TIMESTAMP),
  ('ai.workout_generation', 'FEATURE', 'AI', 'Permite capacidade de geracao de treino por IA sob governanca.', NULL, 'ACTIVE', CURRENT_TIMESTAMP),
  ('ai.content_recommendation', 'FEATURE', 'AI', 'Permite capacidade de recomendacao de conteudo por IA sob governanca.', NULL, 'ACTIVE', CURRENT_TIMESTAMP);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ProductPlanEntitlement" e
    LEFT JOIN "ProductCapabilityDefinition" c ON c."key" = e."featureKey"
    WHERE c."key" IS NULL
  ) THEN
    RAISE EXCEPTION 'ProductPlanEntitlement contains capability absent from configurable catalog';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "TenantProductConfiguration" e
    LEFT JOIN "ProductCapabilityDefinition" c ON c."key" = e."featureKey"
    WHERE c."key" IS NULL
  ) THEN
    RAISE EXCEPTION 'TenantProductConfiguration contains capability absent from configurable catalog';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "UserProductPreference" e
    LEFT JOIN "ProductCapabilityDefinition" c ON c."key" = e."featureKey"
    WHERE c."key" IS NULL
  ) THEN
    RAISE EXCEPTION 'UserProductPreference contains capability absent from configurable catalog';
  END IF;
END $$;

ALTER TABLE "ProductPlanEntitlement"
  ADD CONSTRAINT "ProductPlanEntitlement_featureKey_fkey"
  FOREIGN KEY ("featureKey") REFERENCES "ProductCapabilityDefinition"("key")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "TenantProductConfiguration"
  ADD CONSTRAINT "TenantProductConfiguration_featureKey_fkey"
  FOREIGN KEY ("featureKey") REFERENCES "ProductCapabilityDefinition"("key")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "UserProductPreference"
  ADD CONSTRAINT "UserProductPreference_featureKey_fkey"
  FOREIGN KEY ("featureKey") REFERENCES "ProductCapabilityDefinition"("key")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
