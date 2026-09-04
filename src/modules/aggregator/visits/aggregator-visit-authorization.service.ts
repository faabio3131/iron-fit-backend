import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AggregatorAgreementStatus,
  AggregatorConnectionStatus,
  AggregatorEligibilityStatus,
  AggregatorVisitStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthorizeAggregatorVisitDto } from './dto/authorize-aggregator-visit.dto';
import { evaluateEligibilityEvidence } from '../eligibility/aggregator-eligibility.service';

const MAX_SERIALIZABLE_RETRIES = 3;
const OPERATOR_API_SOURCE = 'IRON_OPERATOR_API';

const VISIT_SELECT = {
  id: true,
  memberId: true,
  agreementId: true,
  eligibilityCheckId: true,
  externalVisitId: true,
  status: true,
  requestedAt: true,
  authorizedAt: true,
  expiresAt: true,
  denialReason: true,
  provenance: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AggregatorVisitAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private requireGym(gymId?: string) {
    if (!gymId) {
      throw new BadRequestException('Tenant ativo obrigatorio');
    }
    return gymId;
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable || attempt === MAX_SERIALIZABLE_RETRIES) {
          throw error;
        }
      }
    }

    throw new ConflictException('Falha de concorrencia na autorizacao de visita');
  }

  async authorize(
    dto: AuthorizeAggregatorVisitDto,
    gymId?: string,
    actorUserId?: string,
    source = OPERATOR_API_SOURCE,
  ) {
    const tenantId = this.requireGym(gymId);

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const member = await tx.aggregatorMember.findFirst({
            where: {
              id: dto.memberId,
              connection: { gymId: tenantId },
            },
            select: {
              id: true,
              connection: {
                select: {
                  id: true,
                  status: true,
                },
              },
            },
          });

          if (!member) {
            throw new NotFoundException('Membro agregador nao encontrado');
          }

          const existing = await tx.aggregatorVisitAuthorization.findUnique({
            where: {
              memberId_externalVisitId: {
                memberId: member.id,
                externalVisitId: dto.externalVisitId,
              },
            },
            select: VISIT_SELECT,
          });

          if (existing) {
            return existing;
          }

          const now = new Date();
          const agreement = await tx.aggregatorAgreement.findFirst({
            where: {
              memberId: member.id,
              status: AggregatorAgreementStatus.SIGNED,
            },
            orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }],
            select: {
              id: true,
              signedAt: true,
              status: true,
            },
          });

          const eligibilityCheck = await tx.aggregatorEligibilityCheck.findFirst({
            where: { memberId: member.id },
            orderBy: [{ verifiedAt: 'desc' }, { createdAt: 'desc' }],
            select: {
              id: true,
              status: true,
              verifiedAt: true,
              validUntil: true,
              reasonCode: true,
            },
          });

          const eligibility = evaluateEligibilityEvidence(eligibilityCheck, now);

          let denialReason: string | null = null;
          if (member.connection.status !== AggregatorConnectionStatus.ACTIVE) {
            denialReason = 'PROVIDER_CONNECTION_NOT_ACTIVE';
          } else if (!agreement?.signedAt) {
            denialReason = 'AGREEMENT_NOT_SIGNED';
          } else if (eligibility.status === AggregatorEligibilityStatus.UNKNOWN) {
            denialReason = 'ELIGIBILITY_UNKNOWN';
          } else if (eligibility.status === AggregatorEligibilityStatus.INELIGIBLE) {
            denialReason = 'ELIGIBILITY_INELIGIBLE';
          }

          const confirmed = denialReason === null;
          const status = confirmed
            ? AggregatorVisitStatus.CONFIRMED
            : AggregatorVisitStatus.DENIED;

          const provenance: Prisma.InputJsonValue = {
            source,
            decisionVersion: 'AGG3_V1',
            decidedAt: now.toISOString(),
            connectionStatus: member.connection.status,
            eligibilityStatus: eligibility.status,
            eligibilityEvidenceStatus: eligibility.evidenceStatus,
            ...(eligibility.reasonCode
              ? { eligibilityReasonCode: eligibility.reasonCode }
              : {}),
          };

          const created = await tx.aggregatorVisitAuthorization.create({
            data: {
              memberId: member.id,
              agreementId: agreement?.id ?? null,
              eligibilityCheckId: eligibility.checkId,
              externalVisitId: dto.externalVisitId,
              status,
              authorizedAt: confirmed ? now : null,
              expiresAt: confirmed ? eligibility.validUntil : null,
              denialReason,
              provenance,
            },
            select: VISIT_SELECT,
          });

          await this.audit.record(
            {
              gymId: tenantId,
              userId: actorUserId ?? null,
              action: 'AGGREGATOR_VISIT_AUTHORIZATION_DECIDED',
              entity: 'AggregatorVisitAuthorization',
              entityId: created.id,
              next: {
                memberId: created.memberId,
                agreementId: created.agreementId,
                eligibilityCheckId: created.eligibilityCheckId,
                externalVisitId: created.externalVisitId,
                status: created.status,
                authorizedAt: created.authorizedAt,
                expiresAt: created.expiresAt,
                denialReason: created.denialReason,
              },
            },
            tx,
          );

          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async findOne(id: string, gymId?: string) {
    const tenantId = this.requireGym(gymId);
    const authorization = await this.prisma.aggregatorVisitAuthorization.findFirst({
      where: {
        id,
        member: { connection: { gymId: tenantId } },
      },
      select: VISIT_SELECT,
    });

    if (!authorization) {
      throw new NotFoundException('Autorizacao de visita nao encontrada');
    }

    return authorization;
  }
}
