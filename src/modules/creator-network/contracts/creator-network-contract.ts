export const CREATOR_CONTENT_RELATION_KINDS = [
  'EXTERNAL_REFERENCE',
  'LICENSED_CONTENT',
  'IRON_OWNED',
  'TENANT_OWNED',
] as const;

export type CreatorContentRelationKind =
  (typeof CREATOR_CONTENT_RELATION_KINDS)[number];

export const MANAGED_CONTENT_RELATION_KINDS = [
  'LICENSED_CONTENT',
  'IRON_OWNED',
  'TENANT_OWNED',
] as const satisfies readonly CreatorContentRelationKind[];

export const CREATOR_RIGHTS_DIMENSIONS = [
  'RIGHTS_HOLDER',
  'LICENSE_BASIS',
  'USAGE_SCOPE',
  'DELIVERY_SCOPE',
  'TERRITORY',
  'VALIDITY_WINDOW',
  'REVOCATION_STATUS',
  'ATTRIBUTION_REQUIREMENT',
] as const;

export type CreatorRightsDimension = (typeof CREATOR_RIGHTS_DIMENSIONS)[number];

export const CREATOR_NETWORK_BLOCKS = [
  'CN0',
  'CN1',
  'CN2',
  'CN3',
  'CN4',
  'CN5',
  'CN6',
  'CN7',
  'CN8',
  'CN9',
] as const;

export type CreatorNetworkBlock = (typeof CREATOR_NETWORK_BLOCKS)[number];

export interface CreatorNetworkCapabilityDefinition {
  key: string;
  ownerBlock: CreatorNetworkBlock;
  description: string;
}

const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

export const CREATOR_NETWORK_CAPABILITY_MAP_V1 = Object.freeze([
  {
    key: 'launch_bridge.external_reference',
    ownerBlock: 'CN0',
    description:
      'Preserva a entrega simples por referência externa sem converter link público em licença ou propriedade.',
  },
  {
    key: 'creator.identity_governance',
    ownerBlock: 'CN1',
    description:
      'Registra criadores, identidades verificáveis, status e governança sem confundir autoria com titularidade de direitos.',
  },
  {
    key: 'rights.license_consent_vault',
    ownerBlock: 'CN2',
    description:
      'Mantém evidência versionada de licença, consentimento, titularidade, escopo, território, validade e revogação.',
  },
  {
    key: 'content.canonical_catalog',
    ownerBlock: 'CN3',
    description:
      'Define conteúdo canônico e media assets independentes de URL de entrega, provider ou exercício.',
  },
  {
    key: 'media.ingestion_delivery',
    ownerBlock: 'CN4',
    description:
      'Abstrai ingestão, armazenamento, CDN e providers sem tornar um fornecedor parte da identidade do conteúdo.',
  },
  {
    key: 'content.exercise_mapping_publishing',
    ownerBlock: 'CN5',
    description:
      'Mapeia exercício para conteúdo elegível e governa publicação sem remover o fallback legado antes de certificação própria.',
  },
  {
    key: 'content.moderation_lifecycle',
    ownerBlock: 'CN6',
    description:
      'Governa qualidade, moderação, versionamento, suspensão, retirada e lifecycle do conteúdo.',
  },
  {
    key: 'content.attribution_usage_engagement',
    ownerBlock: 'CN7',
    description:
      'Registra atribuição, uso e engajamento como fatos auditáveis sem transformar métricas em prova de direitos.',
  },
  {
    key: 'creator.commercial_settlement',
    ownerBlock: 'CN8',
    description:
      'Define regras comerciais, revenue share e settlement de criadores como domínio separado do financeiro do aluno e do plano SaaS.',
  },
  {
    key: 'creator.operations_analytics_certification',
    ownerBlock: 'CN9',
    description:
      'Entrega console operacional, analytics e certificação integral da Creator Network.',
  },
] as const satisfies readonly CreatorNetworkCapabilityDefinition[]);

export function requiresManagedRightsProvenance(
  relationKind: CreatorContentRelationKind,
): boolean {
  return relationKind !== 'EXTERNAL_REFERENCE';
}

export function canHostManagedMedia(
  relationKind: CreatorContentRelationKind,
): boolean {
  return MANAGED_CONTENT_RELATION_KINDS.includes(
    relationKind as (typeof MANAGED_CONTENT_RELATION_KINDS)[number],
  );
}

export function assertCreatorNetworkCapabilityMap(
  capabilities: readonly CreatorNetworkCapabilityDefinition[],
): void {
  const keys = new Set<string>();
  const blocks = new Set<CreatorNetworkBlock>();

  for (const capability of capabilities) {
    if (!CAPABILITY_KEY_PATTERN.test(capability.key)) {
      throw new Error(`creator capability key canonica invalida: ${capability.key}`);
    }
    if (!capability.description.trim()) {
      throw new Error(`creator capability sem descricao: ${capability.key}`);
    }
    if (keys.has(capability.key)) {
      throw new Error(`creator capability duplicada: ${capability.key}`);
    }

    keys.add(capability.key);
    blocks.add(capability.ownerBlock);
  }

  for (const block of CREATOR_NETWORK_BLOCKS) {
    if (!blocks.has(block)) {
      throw new Error(`creator network block sem capability: ${block}`);
    }
  }
}

assertCreatorNetworkCapabilityMap(CREATOR_NETWORK_CAPABILITY_MAP_V1);
