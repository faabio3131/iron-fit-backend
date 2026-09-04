import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AggregatorEligibilityStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';

const MAX_SERIALIZABLE_RETRIES = 3;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

const ELIGIBILITY_SELECT = {
  id: true,
  memberId: true,
  membershipId: true,
  externalCheckId: true,
  status: true,
  providerStatus: true,
  reasonCode: true,
  verifiedAt: true,
  validUntil: true,
  scope: true,
  provenance: true,
  createdAt: true,
} as const;

export interface RecordAggregatorEligibilityInput {
  memberId: string;
  membershipId?: string;
  externalCheckId?: string;
  status: AggregatorEligibilityStatus;
  providerStatus?: string;
  reasonCode?: string;
  verifiedAt: Date;
  validUntil?: Date;
  scope?: Prisma.InputJsonValue;
  source: string;
  evidenceRef?: string;
}

export interface AggregatorEligibilityEvaluation {
  status: AggregatorEligibilityStatus;
  evidenceStatus: AggregatorEligibilityStatus | null;
  checkId: string | null;
  verifiedAt: Date | null;
  validUntil: Date | null;
  reasonCode: string | null;
}

interface EligibilityEvidenceLike {
  id: string;
  status: AggregatorEligibilityStatus;
  verifiedAt: Date;
  validUntil: Date | null;
  reasonCode: string | null;
}

export function evaluateEligibilityEvidence(
  check: EligibilityEvidenceLike | null,
  at = new Date(),
): AggregatorEligibilityEvaluation {
  if (!check) {
    return {
      status: AggregatorEligibilityStatus.UNKNOWN,
      evidenceStatus: null,
      checkId: null,
      verifiedAt: null,
      validUntil: null,
      reasonCode: 'NO_ELIGIBILITY_EVIDENCE',
    };
  }

  if (check.verifiedAt.getTime() > at.getTime() + MAX_FUTURE_CLOCK_SKEW_MS) {
    return {
      status: AggregatorEligibilityStatus.UNKNOWN,
      evidenceStatus: check.status,
      checkId: check.id,
      verifiedAt: check.verifiedAt,
      validUntil: check.validUntil,
      reasonCode: 'ELIGIBILITY_EVIDENCE_FROM_FUTURE',
    };
  }

  if (check.status === AggregatorEligibilityStatus.ELIGIBLE) {
    if (!check.validUntil) {
      return {
        status: AggregatorEligibilityStatus.UNKNOWN,
        evidenceStatus: check.status,
        checkId: check.id,
        verifiedAt: check.verifiedAt,
        validUntil: null,
        reasonCode: 'ELIGIBILITY_MISSING_EXPIRY',
      };
    }

    if (check.validUntil.getTime() <= at.getTime()) {
      return {
        status: AggregatorEligibilityStatus.UNKNOWN,
        evidenceStatus: check.status,
        checkId: check.id,
        verifiedAt: check.verifiedAt,
        validUntil: check.validUntil,
        reasonCode: 'ELIGIBILITY_EXPIRED',
      };
    }
  }

  return {
    status: check.status,
    evidenceStatus: check.status,
    checkId: check.id,
    verifiedAt: check.verifiedAt,
    validUntil: check.validUntil,
    reasonCode: check.reasonCode,
  };
}

@Injectable()
export class AggregatorEligibilityService {
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

    throw new ConflictException('Falha de concorrencia na elegibilidade');
  }

  async recordProviderEvidence(
    input: RecordAggregatorEligibilityInput,
    gymId?: string,
    actorUserId?: string,
  ) {
    const tenantId = this.requireGym(gymId);
    const now = new Date();

    if (!input.source.trim()) {
      throw new BadRequestException('Fonte da evidencia de elegibilidade obrigatoria');
    }

    if (input.verifiedAt.getTime() > now.getTime() + MAX_FUTURE_CLOCK_SKEW_MS) {
      throw new BadRequestException('Momento de verificacao de elegibilidade invalido');
    }

    if (
      input.status === AggregatorEligibilityStatus.ELIGIBLE &&
      (!input.validUntil || input.validUntil <= input.verifiedAt)
    ) {
      throw new BadRequestException(
        'Evidencia ELIGIBLE exige uma validade posterior ao momento verificado',
      );
    }

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const member = await tx.aggregatorMember.findFirst({
            where: {
              id: input.memberId,
              connection: { gymId: tenantId },
            },
            select: {
              id: true,
              connectionId: true,
            },
          });

          if (!member) {
            throw new NotFoundException('Membro agregador nao encontrado');
          }

          if (input.membershipId) {
            const membership = await tx.aggregatorMembership.findFirst({
              where: {
                id: input.membershipId,
                memberId: member.id,
              },
              select: { id: true },
            });
            if (!membership) {
              throw new NotFoundException('Vinculo agregador nao encontrado');
            }
          }

          if (input.externalCheckId) {
            const existing = await tx.aggregatorEligibilityCheck.findUnique({
              where: {
                memberId_externalCheckId: {
                  memberId: member.id,
                  externalCheckId: input.externalCheckId,
                },
              },
              select: ELIGIBILITY_SELECT,
            });

            if (existing) {
              const sameEvidence =
                existing.status === input.status &&
                existing.membershipId === (input.membershipId ?? null) &&
                existing.providerStatus === (input.providerStatus ?? null) &&
                existing.reasonCode === (input.reasonCode ?? null) &&
                existing.verifiedAt.getTime() === input.verifiedAt.getTime() &&
                (existing.validUntil?.getTime() ?? null) ===
                  (input.validUntil?.getTime() ?? null);

              if (sameEvidence) {
                return existing;
              }

              throw new ConflictException(
                'Identificador de verificacao ja registrado com outra evidencia',
              );
            }
          }

          const provenance: Prisma.InputJsonValue = {
            source: input.source,
            observedAt: now.toISOString(),
            ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
          };

          const created = await tx.aggregatorEligibilityCheck.create({
            data: {
              memberId: member.id,
              membershipId: input.membershipId ?? null,
              externalCheckId: input.externalCheckId ?? null,
              status: input.status,
              providerStatus: input.providerStatus ?? null,
              reasonCode: input.reasonCode ?? null,
              verifiedAt: input.verifiedAt,
              validUntil: input.validUntil ?? null,
              scope: input.scope ?? Prisma.JsonNull,
              provenance,
            },
            select: ELIGIBILITY_SELECT,
          });

          await this.audit.record(
            {
              gymId: tenantId,
              userId: actorUserId ?? null,
              action: 'AGGREGATOR_ELIGIBILITY_CHECK_RECORDED',
              entity: 'AggregatorEligibilityCheck',
              entityId: created.id,
              next: {
                memberId: created.memberId,
                membershipId: created.membershipId,
                externalCheckId: created.externalCheckId,
                status: created.status,
                providerStatus: created.providerStatus,
                reasonCode: created.reasonCode,
                verifiedAt: created.verifiedAt,
                validUntil: created.validUntil,
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

  async findCurrent(memberId: string, gymId?: string, at = new Date()) {
    const tenantId = this.requireGym(gymId);
    const member = await this.prisma.aggregatorMember.findFirst({
      where: {
        id: memberId,
        connection: { gymId: tenantId },
      },
      select: { id: true },
    });

    if (!member) {
      throw new NotFoundException('Membro agregador nao encontrado');
    }

    const check = await this.prisma.aggregatorEligibilityCheck.findFirst({
      where: { memberId: member.id },
      orderBy: [{ verifiedAt: 'desc' }, { createdAt: 'desc' }],
      select: ELIGIBILITY_SELECT,
    });

    return evaluateEligibilityEvidence(check, at);
  }
}
