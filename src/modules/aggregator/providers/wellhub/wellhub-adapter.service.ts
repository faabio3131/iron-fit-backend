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
  WELLHUB_PARTNER_TRANSPORT,
  WellhubEligibilityEvidence,
  WellhubPartnerTransport,
} from './wellhub-partner-transport';

const WELLHUB_PROVIDER_CODE = 'WELLHUB';
const WELLHUB_SOURCE = 'WELLHUB_ADAPTER';
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface WellhubAuthorizeVisitInput {
  memberId: string;
  externalVisitId: string;
}

@Injectable()
export class WellhubAdapterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: AggregatorEligibilityService,
    private readonly visits: AggregatorVisitAuthorizationService,
    @Optional()
    @Inject(WELLHUB_PARTNER_TRANSPORT)
    private readonly transport?: WellhubPartnerTransport,
  ) {}

  private requireGym(gymId?: string) {
    if (!gymId) {
      throw new BadRequestException('Tenant ativo obrigatorio');
    }
    return gymId;
  }

  private async recordUnknown(
    memberId: string,
    gymId: string,
    actorUserId: string | undefined,
    reasonCode: string,
    providerStatus?: string,
  ) {
    return this.eligibility.recordProviderEvidence(
      {
        memberId,
        status: AggregatorEligibilityStatus.UNKNOWN,
        providerStatus,
        reasonCode,
        verifiedAt: new Date(),
        source: WELLHUB_SOURCE,
      },
      gymId,
      actorUserId,
    );
  }

  private normalizeEvidence(
    evidence: WellhubEligibilityEvidence,
    now: Date,
  ): WellhubEligibilityEvidence {
    if (
      evidence.verifiedAt.getTime() >
      now.getTime() + MAX_FUTURE_CLOCK_SKEW_MS
    ) {
      return {
        canonicalStatus: AggregatorEligibilityStatus.UNKNOWN,
        providerStatus: evidence.providerStatus,
        reasonCode: 'WELLHUB_INVALID_PROVIDER_TIMESTAMP',
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
        reasonCode: 'WELLHUB_ELIGIBLE_WITHOUT_VALID_EXPIRY',
      };
    }

    return evidence;
  }

  async refreshEligibilityAndAuthorize(
    input: WellhubAuthorizeVisitInput,
    gymId?: string,
    actorUserId?: string,
  ) {
    const tenantId = this.requireGym(gymId);

    const member = await this.prisma.aggregatorMember.findFirst({
      where: {
        id: input.memberId,
        connection: {
          gymId: tenantId,
          providerCode: WELLHUB_PROVIDER_CODE,
        },
      },
      select: {
        id: true,
        externalMemberId: true,
        connection: {
          select: {
            id: true,
            status: true,
            externalLocationId: true,
            contractVersion: true,
            lastVerifiedAt: true,
          },
        },
      },
    });

    if (!member) {
      throw new NotFoundException('Membro Wellhub nao encontrado');
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
        WELLHUB_SOURCE,
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
        'WELLHUB_NOT_HOMOLOGATED',
      );
      return this.visits.authorize(
        input,
        tenantId,
        actorUserId,
        WELLHUB_SOURCE,
      );
    }

    if (!this.transport) {
      await this.recordUnknown(
        member.id,
        tenantId,
        actorUserId,
        'WELLHUB_TRANSPORT_UNAVAILABLE',
      );
      return this.visits.authorize(
        input,
        tenantId,
        actorUserId,
        WELLHUB_SOURCE,
      );
    }

    const now = new Date();
    let evidence: WellhubEligibilityEvidence;
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
        'WELLHUB_TRANSPORT_UNAVAILABLE',
      );
      return this.visits.authorize(
        input,
        tenantId,
        actorUserId,
        WELLHUB_SOURCE,
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
        source: WELLHUB_SOURCE,
        evidenceRef: normalized.evidenceRef,
      },
      tenantId,
      actorUserId,
    );

    return this.visits.authorize(
      input,
      tenantId,
      actorUserId,
      WELLHUB_SOURCE,
    );
  }
}
