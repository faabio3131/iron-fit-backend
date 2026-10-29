export const ENTITLEMENT_VALUE_KINDS = ['FEATURE', 'LIMIT', 'POLICY'] as const;

export type EntitlementValueKind = (typeof ENTITLEMENT_VALUE_KINDS)[number];

export const PRODUCT_CAPABILITY_DOMAINS = [
  'CORE',
  'CONTENT',
  'EQUIPMENT',
  'AGGREGATOR',
  'ANALYTICS',
  'FINANCIAL',
  'AI',
] as const;

export type ProductCapabilityDomain = (typeof PRODUCT_CAPABILITY_DOMAINS)[number];

export const PRODUCT_CONFIGURATION_PRECEDENCE = [
  'IRON_POLICY',
  'PLAN_ENTITLEMENT',
  'TENANT_CONFIGURATION',
  'USER_PREFERENCE',
] as const;

export type ProductConfigurationLayer =
  (typeof PRODUCT_CONFIGURATION_PRECEDENCE)[number];

export type FailClosedDefault = false | 0 | null;

export interface ProductFeatureDefinition {
  key: string;
  kind: EntitlementValueKind;
  domain: string;
  description: string;
  failClosedDefault: FailClosedDefault;
  allowedPolicyValues?: readonly string[];
}

export interface ProductPlanVersionReference {
  planCode: string;
  version: number;
}

export interface ProductEntitlementContract {
  featureKey: string;
  kind: EntitlementValueKind;
  value: boolean | number | readonly string[];
}

export const SAAS_PRODUCT_PLAN_DOMAIN = 'IRON_PRODUCT_PLAN' as const;
export const STUDENT_FINANCIAL_SUBSCRIPTION_DOMAIN =
  'STUDENT_FINANCIAL_SUBSCRIPTION' as const;

const FEATURE_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const CAPABILITY_DOMAIN_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const PLAN_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const POLICY_VALUE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export function defineProductFeature(
  definition: ProductFeatureDefinition,
): Readonly<ProductFeatureDefinition> {
  if (!FEATURE_KEY_PATTERN.test(definition.key)) {
    throw new Error(`feature key canonica invalida: ${definition.key}`);
  }
  if (!CAPABILITY_DOMAIN_PATTERN.test(definition.domain)) {
    throw new Error(`domain de capability invalido: ${definition.key}`);
  }
  if (!definition.description.trim()) {
    throw new Error(`feature sem descricao: ${definition.key}`);
  }

  if (definition.kind === 'FEATURE' && definition.failClosedDefault !== false) {
    throw new Error(`FEATURE deve falhar fechado para false: ${definition.key}`);
  }
  if (definition.kind === 'LIMIT' && definition.failClosedDefault !== 0) {
    throw new Error(`LIMIT deve falhar fechado para 0: ${definition.key}`);
  }
  if (definition.kind === 'POLICY') {
    if (definition.failClosedDefault !== null) {
      throw new Error(`POLICY deve falhar fechado para null: ${definition.key}`);
    }
    const values = definition.allowedPolicyValues ?? [];
    if (values.length === 0 || values.some((value) => !POLICY_VALUE_PATTERN.test(value))) {
      throw new Error(`POLICY sem valores canonicos: ${definition.key}`);
    }
    if (new Set(values).size !== values.length) {
      throw new Error(`POLICY possui valores duplicados: ${definition.key}`);
    }
  } else if (definition.allowedPolicyValues?.length) {
    throw new Error(`Somente POLICY aceita allowedPolicyValues: ${definition.key}`);
  }

  return Object.freeze({
    ...definition,
    allowedPolicyValues: definition.allowedPolicyValues
      ? Object.freeze([...definition.allowedPolicyValues])
      : undefined,
  });
}

export function definePlanVersionReference(
  reference: ProductPlanVersionReference,
): Readonly<ProductPlanVersionReference> {
  if (!PLAN_CODE_PATTERN.test(reference.planCode)) {
    throw new Error('planCode canonico invalido');
  }
  if (!Number.isInteger(reference.version) || reference.version < 1) {
    throw new Error('version deve ser inteiro positivo');
  }
  return Object.freeze({ ...reference });
}

export function canNarrowFeature(
  planEnabled: boolean,
  requestedEnabled: boolean,
): boolean {
  return !requestedEnabled || planEnabled;
}

export function canNarrowLimit(planLimit: number, requestedLimit: number): boolean {
  return (
    Number.isFinite(planLimit) &&
    Number.isFinite(requestedLimit) &&
    planLimit >= 0 &&
    requestedLimit >= 0 &&
    requestedLimit <= planLimit
  );
}

export function canNarrowPolicy(
  planAllowedValues: readonly string[],
  requestedAllowedValues: readonly string[],
): boolean {
  const planSet = new Set(planAllowedValues);
  return requestedAllowedValues.every((value) => planSet.has(value));
}

// Historical PE0 bootstrap fixture only. Runtime commercial authority lives in ProductCapabilityDefinition.
export const PRODUCT_FEATURE_CATALOG_V1 = Object.freeze([
  defineProductFeature({
    key: 'content.external_youtube',
    kind: 'FEATURE',
    domain: 'CONTENT',
    description: 'Permite entrega por referência externa do YouTube sem declarar propriedade do conteúdo.',
    failClosedDefault: false,
  }),
  defineProductFeature({
    key: 'content.iron_managed',
    kind: 'FEATURE',
    domain: 'CONTENT',
    description: 'Permite conteúdo de mídia gerenciado pelo IRON quando a infraestrutura correspondente estiver disponível.',
    failClosedDefault: false,
  }),
  defineProductFeature({
    key: 'content.tenant_private',
    kind: 'FEATURE',
    domain: 'CONTENT',
    description: 'Permite conteúdo privado pertencente ao tenant conforme governança da Creator Network.',
    failClosedDefault: false,
  }),
  defineProductFeature({
    key: 'content.private_items_max',
    kind: 'LIMIT',
    domain: 'CONTENT',
    description: 'Limite superior de itens privados de conteúdo disponibilizados ao tenant.',
    failClosedDefault: 0,
  }),
  defineProductFeature({
    key: 'content.delivery_mode',
    kind: 'POLICY',
    domain: 'CONTENT',
    description: 'Conjunto de modos de entrega que um plano pode autorizar para configuração do tenant.',
    failClosedDefault: null,
    allowedPolicyValues: [
      'YOUTUBE_EXTERNAL',
      'IRON_FIRST',
      'TENANT_PRIVATE_FIRST',
      'IRON_ONLY',
      'YOUTUBE_ONLY',
    ],
  }),
  defineProductFeature({
    key: 'equipment.catalog',
    kind: 'FEATURE',
    domain: 'EQUIPMENT',
    description: 'Permite acesso ao catálogo canônico de equipamentos IRON.',
    failClosedDefault: false,
  }),
  defineProductFeature({
    key: 'equipment.inventory',
    kind: 'FEATURE',
    domain: 'EQUIPMENT',
    description: 'Permite ao tenant manter inventário derivado do catálogo canônico.',
    failClosedDefault: false,
  }),
  defineProductFeature({
    key: 'aggregator.wellhub',
    kind: 'FEATURE',
    domain: 'AGGREGATOR',
    description: 'Permite habilitar a capacidade Wellhub quando a integração estiver homologada.',
    failClosedDefault: false,
  }),
  defineProductFeature({
    key: 'aggregator.totalpass',
    kind: 'FEATURE',
    domain: 'AGGREGATOR',
    description: 'Permite habilitar a capacidade TotalPass quando a integração estiver homologada.',
    failClosedDefault: false,
  }),
  defineProductFeature({
    key: 'analytics.aggregator',
    kind: 'FEATURE',
    domain: 'ANALYTICS',
    description: 'Permite analytics gerenciais do Aggregator Hub.',
    failClosedDefault: false,
  }),
  defineProductFeature({
    key: 'ai.workout_generation',
    kind: 'FEATURE',
    domain: 'AI',
    description: 'Reserva canônica para geração de treino por IA sob governança humana futura.',
    failClosedDefault: false,
  }),
  defineProductFeature({
    key: 'ai.content_recommendation',
    kind: 'FEATURE',
    domain: 'AI',
    description: 'Reserva canônica para recomendação de conteúdo por IA sob políticas futuras.',
    failClosedDefault: false,
  }),
]);

export function assertCanonicalFeatureCatalog(
  catalog: readonly Readonly<ProductFeatureDefinition>[],
): void {
  const keys = new Set<string>();
  for (const feature of catalog) {
    defineProductFeature(feature);
    if (keys.has(feature.key)) {
      throw new Error(`feature duplicada: ${feature.key}`);
    }
    keys.add(feature.key);
  }
}

assertCanonicalFeatureCatalog(PRODUCT_FEATURE_CATALOG_V1);
