import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AggregatorConnectionStatus,
  AggregatorEligibilityStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AggregatorEligibilityService } from '../../eligibility/aggregator-eligibility.service';
import { AggregatorVisitAuthorizationService } from '../../visits/aggregator-visit-authorization.service';
import {
  CanonicalProviderEligibilityEvidence,
  ProviderContractDescriptor,
} from '../contracts/future-provider-contract';
import { TOTALPASS_PROVIDER_CONTRACT } from './totalpass-contract';
import {
  TOTALPASS_PARTNER_TRANSPORT,
  TotalPassPartnerTransport,
} from './totalpass-partner-transport';

const TOTALPASS_PROVIDER_CODE = 'TOTALPASS';
const TOTALPASS_SOURCE = 'TOTALPASS_ADAPTER';
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface TotalPassAuthorizeVisitInput {
  memberId: string;
  externalVisitId: string;
}

@Injectable()
export class TotalPassAdapterService {
  readonly descriptor: ProviderContractDescriptor = TOTALPASS_PROVIDER_CONTRACT;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: AggregatorEligibilityService,
    private readonly visits: AggregatorVisitAuthorizationService,
    @Optional()
    @Inject(TOTALPASS_PARTNER_TRANSPORT)
    private readonly transport?: TotalPassPartnerTransport,
  ) {}

  private requireGym(gymId?: string) {
    if (!gymId) {
      throw new BadRequestException('Tenant ativo obrigatorio');
    }
    return gymId;
  }

  private normalizeEvidence(
    evidence: CanonicalProviderEligibilityEvidence,
    now: Date,
  ): CanonicalProviderEligibilityEvidence {
    if (
      evidence.verifiedAt.getTime() >
      now.getTime() + MAX_FUTURE_CLOCK_SKEW_MS
    ) {
      return {
        canonicalStatus: AggregatorEligibilityStatus.UNKNOWN,
        providerStatus: evidence.providerStatus,
        reasonCode: 'TOTALPASS_INVALID_PROVIDER_TIMESTAMP',
        verifiedAt: now,
        evidenceRef: evidence.evidenceRef,
      };
    }

    if (
      evidence.canonicalStatus === AggregatorEligibilityStatus.ELIGIBLE &&
      (!evidence.validUntil || evidence.validUntil <= evidence.verifiedAt)
    ) {
      return {
        ...evidence,
        canonicalStatus: AggregatorEligibilityStatus.UNKNOWN,
        reasonCode: 'TOTALPASS_ELIGIBLE_WITHOUT_VALID_EXPIRY',
      };
    }

    return evidence;
  }

  private async recordUnknown(
    memberId: string,
    gymId: string,
    actorUserId: string | undefined,
    reasonCode: string,
  ) {
    return this.eligibility.recordProviderEvidence(
      {
        memberId,
        status: AggregatorEligibilityStatus.UNKNOWN,
        reasonCode,
        verifiedAt: new Date(),
        source: TOTALPASS_SOURCE,
      },
      gymId,
      actorUserId,
    );
  }

  async refreshEligibilityAndAuthorize(
    input: TotalPassAuthorizeVisitInput,
    gymId?: string,
    actorUserId?: string,
  ) {
    const tenantId = this.requireGym(gymId);

    const member = await this.prisma.aggregatorMember.findFirst({
      where: {
        id: input.memberId,
        connection: {
          gymId: tenantId,
          providerCode: TOTALPASS_PROVIDER_CODE,
        },
      },
      select: {
        id: true,
        externalMemberId: true,
        connection: {
          select: {
            status: true,
            externalLocationId: true,
            contractVersion: true,
            lastVerifiedAt: true,
          },
        },
      },
    });

    if (!member) {
      throw new NotFoundException('Membro TotalPass nao encontrado');
    }

    const existing = await this.prisma.aggregatorVisitAuthorization.findUnique({
      where: {
        memberId_externalVisitId: {
          memberId: member.id,
          externalVisitId: input.externalVisitId,
        },
      },
    });

    if (existing) {
      return existing;
    }

    if (member.connection.status !== AggregatorConnectionStatus.ACTIVE) {
      return this.visits.authorize(
        input,
        tenantId,
        actorUserId,
        TOTALPASS_SOURCE,
      );
    }

    if (
      !member.connection.externalLocationId ||
      !member.connection.contractVersion ||
      !member.connection.lastVerifiedAt
    ) {
      await this.recordUnknown(
        member.id,
        tenantId,
        actorUserId,
        'TOTALPASS_NOT_HOMOLOGATED',
      );
      return this.visits.authorize(
        input,
        tenantId,
        actorUserId,
        TOTALPASS_SOURCE,
      );
    }

    if (!this.transport) {
      await this.recordUnknown(
        member.id,
        tenantId,
        actorUserId,
        'TOTALPASS_TRANSPORT_UNAVAILABLE',
      );
      return this.visits.authorize(
        input,
        tenantId,
        actorUserId,
        TOTALPASS_SOURCE,
      );
    }

    const now = new Date();
    let evidence: CanonicalProviderEligibilityEvidence;
    try {
      evidence = await this.transport.fetchCurrentEligibility({
        externalLocationId: member.connection.externalLocationId,
        externalMemberId: member.externalMemberId,
        requestedAt: now,
      });
    } catch {
      await this.recordUnknown(
        member.id,
        tenantId,
        actorUserId,
        'TOTALPASS_TRANSPORT_UNAVAILABLE',
      );
      return this.visits.authorize(
        input,
        tenantId,
        actorUserId,
        TOTALPASS_SOURCE,
      );
    }

    const normalized = this.normalizeEvidence(evidence, now);
    let membershipId: string | undefined;

    if (normalized.externalMembershipId) {
      const membership = await this.prisma.aggregatorMembership.findFirst({
        where: {
          memberId: member.id,
          externalMembershipId: normalized.externalMembershipId,
        },
        select: { id: true },
      });
      membershipId = membership?.id;
    }

    await this.eligibility.recordProviderEvidence(
      {
        memberId: member.id,
        membershipId,
        externalCheckId: normalized.externalCheckId,
        status: normalized.canonicalStatus,
        providerStatus: normalized.providerStatus,
        reasonCode: normalized.reasonCode,
        verifiedAt: normalized.verifiedAt,
        validUntil: normalized.validUntil,
        source: TOTALPASS_SOURCE,
        evidenceRef: normalized.evidenceRef,
      },
      tenantId,
      actorUserId,
    );

    return this.visits.authorize(
      input,
      tenantId,
      actorUserId,
      TOTALPASS_SOURCE,
    );
  }
}
