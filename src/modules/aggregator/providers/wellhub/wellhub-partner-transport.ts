import { AggregatorEligibilityStatus } from '@prisma/client';

export const WELLHUB_PARTNER_TRANSPORT = Symbol('WELLHUB_PARTNER_TRANSPORT');

export interface WellhubEligibilityRequest {
  externalLocationId: string;
  externalMemberId: string;
  requestedAt: Date;
}

export interface WellhubEligibilityEvidence {
  canonicalStatus: AggregatorEligibilityStatus;
  externalCheckId?: string;
  externalMembershipId?: string;
  providerStatus?: string;
  reasonCode?: string;
  verifiedAt: Date;
  validUntil?: Date;
  evidenceRef?: string;
}

export interface WellhubPartnerTransport {
  fetchCurrentEligibility(
    request: WellhubEligibilityRequest,
  ): Promise<WellhubEligibilityEvidence>;
}
