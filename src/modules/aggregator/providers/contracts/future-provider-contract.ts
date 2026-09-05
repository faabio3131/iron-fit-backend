import { AggregatorEligibilityStatus } from '@prisma/client';

export const AGGREGATOR_PROVIDER_CAPABILITIES = [
  'PARTNER_CONNECTION',
  'MEMBER_IDENTITY',
  'CURRENT_VISIT_ELIGIBILITY',
  'CHECKIN_EVENT_INBOUND',
  'CHECKIN_CONFIRMATION_OUTBOUND',
  'BOOKING_INVENTORY_SYNC',
  'BOOKING_RESERVATION_SYNC',
  'ATTENDANCE_SYNC',
  'LOCATION_SYNC',
  'PLAN_OR_PRODUCT_SCOPE',
  'SETTLEMENT_VISIBILITY',
  'SETTLEMENT_API',
  'WEBHOOK_MANAGEMENT',
  'REPLAY_IDEMPOTENCY_SIGNAL',
  'SANDBOX_OR_TEST_ENV',
  'RATE_LIMIT_CONTRACT',
  'PROVIDER_HEALTH_SIGNAL',
] as const;

export type AggregatorProviderCapability =
  (typeof AGGREGATOR_PROVIDER_CAPABILITIES)[number];

export type ProviderCapabilityEvidenceStatus =
  | 'PUBLICLY_CONFIRMED'
  | 'PARTNER_ACCESS_REQUIRED'
  | 'NOT_PUBLICLY_CONFIRMED'
  | 'NOT_APPLICABLE';

export interface ProviderContractDescriptor {
  providerCode: string;
  adapterVersion: string;
  capabilities: Readonly<
    Record<AggregatorProviderCapability, ProviderCapabilityEvidenceStatus>
  >;
}

export interface CanonicalProviderEligibilityRequest {
  externalLocationId: string;
  externalMemberId: string;
  requestedAt: Date;
}

export interface CanonicalProviderEligibilityEvidence {
  canonicalStatus: AggregatorEligibilityStatus;
  externalCheckId?: string;
  externalMembershipId?: string;
  providerStatus?: string;
  reasonCode?: string;
  verifiedAt: Date;
  validUntil?: Date;
  evidenceRef?: string;
}

export interface ProviderEligibilityTransport {
  fetchCurrentEligibility(
    request: CanonicalProviderEligibilityRequest,
  ): Promise<CanonicalProviderEligibilityEvidence>;
}

export function defineProviderContract(
  descriptor: ProviderContractDescriptor,
): ProviderContractDescriptor {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(descriptor.providerCode)) {
    throw new Error('providerCode canonico invalido');
  }
  if (!descriptor.adapterVersion.trim()) {
    throw new Error('adapterVersion obrigatoria');
  }

  for (const capability of AGGREGATOR_PROVIDER_CAPABILITIES) {
    if (!descriptor.capabilities[capability]) {
      throw new Error(`Capability sem classificacao: ${capability}`);
    }
  }

  return Object.freeze({
    ...descriptor,
    capabilities: Object.freeze({ ...descriptor.capabilities }),
  });
}
