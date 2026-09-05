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
  AggregatorProvisionalDecisionStatus,
  AggregatorRevalidationStatus,
  AggregatorVisitStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { evaluateEligibilityEvidence } from '../eligibility/aggregator-eligibility.service';

const MAX_SERIALIZABLE_RETRIES = 3;
const DECISION_VERSION = 'AGG6_V1';
const MAX_POLICY_DURATION_MINUTES = 120;
const MAX_POLICY_LOOKBACK_MINUTES = 7 * 24 * 60;
const MAX_POLICY_REVALIDATION_ATTEMPTS = 10;

interface EnabledProvisionalPolicy {
  state: 'ENABLED';
  version: string;
  maxDurationMinutes: number;
  eligibilityLookbackMinutes: number;
  maxRevalidationAttempts: number;
}

type ParsedProvisionalPolicy =
  | EnabledProvisionalPolicy
  | { state: 'DISABLED' }
  | { state: 'INVALID' };

interface PolicySnapshot {
  maxRevalidationAttempts: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= max
  );
}

export function parseProvisionalAccessPolicy(
  configuration: unknown,
): ParsedProvisionalPolicy {
  const root = asRecord(configuration);
  const raw = asRecord(root?.provisionalAccessPolicy);

  if (!raw || raw.enabled !== true) {
    return { state: 'DISABLED' };
  }

  if (
    typeof raw.version !== 'string' ||
    !raw.version.trim() ||
    !positiveInteger(raw.maxDurationMinutes, MAX_POLICY_DURATION_MINUTES) ||
    !positiveInteger(
      raw.eligibilityLookbackMinutes,
      MAX_POLICY_LOOKBACK_MINUTES,
    ) ||
    !positiveInteger(
      raw.maxRevalidationAttempts,
      MAX_POLICY_REVALIDATION_ATTEMPTS,
    )
  ) {
    return { state: 'INVALID' };
  }

  return {
    state: 'ENABLED',
    version: raw.version.trim(),
    maxDurationMinutes: raw.maxDurationMinutes,
    eligibilityLookbackMinutes: raw.eligibilityLookbackMinutes,
    maxRevalidationAttempts: raw.maxRevalidationAttempts,
  };
}

function isTransientProviderFailure(reasonCode: string | null) {
  return (
    reasonCode === 'PROVIDER_TRANSPORT_UNAVAILABLE' ||
    Boolean(reasonCode?.endsWith('_TRANSPORT_UNAVAILABLE'))
  );
}

function mergeJsonObject(
  value: unknown,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  return {
    ...(asRecord(value) ?? {}),
    ...patch,
  } as Prisma.InputJsonValue;
}

function readPolicySnapshot(metadata: unknown): PolicySnapshot | null {
  const raw = asRecord(metadata);
  if (
    !raw ||
    !positiveInteger(
      raw.maxRevalidationAttempts,
      MAX_POLICY_REVALIDATION_ATTEMPTS,
    )
  ) {
    return null;
  }

  return { maxRevalidationAttempts: raw.maxRevalidationAttempts };
}

@Injectable()
export class AggregatorProvisionalAccessService {
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

  private requireOperator(actorUserId?: string) {
    if (!actorUserId) {
      throw new BadRequestException(
        'Operador autenticado obrigatorio para acesso provisório',
      );
    }
    return actorUserId;
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

    throw new ConflictException('Falha de concorrencia no acesso provisório');
  }

  private async recordDeniedDecision(
    tx: Prisma.TransactionClient,
    input: {
      visitAuthorizationId: string;
      gymId: string;
      actorUserId: string;
      policyVersion: string | null;
      reason: string;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    const decision = await tx.aggregatorProvisionalDecision.create({
      data: {
        visitAuthorizationId: input.visitAuthorizationId,
        status: AggregatorProvisionalDecisionStatus.DENIED,
        policyVersion: input.policyVersion,
        reason: input.reason,
        authorizedByUserId: input.actorUserId,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });

    await this.audit.record(
      {
        gymId: input.gymId,
        userId: input.actorUserId,
        action: 'AGGREGATOR_PROVISIONAL_ACCESS_DENIED',
        entity: 'AggregatorProvisionalDecision',
        entityId: decision.id,
        next: {
          visitAuthorizationId: decision.visitAuthorizationId,
          status: decision.status,
          policyVersion: decision.policyVersion,
          reason: decision.reason,
        },
      },
      tx,
    );

    return decision;
  }

  async requestProvisionalAccess(
    visitAuthorizationId: string,
    gymId?: string,
    actorUserId?: string,
  ) {
    const tenantId = this.requireGym(gymId);
    const operatorId = this.requireOperator(actorUserId);

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const authorization = await tx.aggregatorVisitAuthorization.findFirst({
            where: {
              id: visitAuthorizationId,
              member: { connection: { gymId: tenantId } },
            },
            select: {
              id: true,
              memberId: true,
              agreementId: true,
              eligibilityCheckId: true,
              externalVisitId: true,
              status: true,
              authorizedAt: true,
              expiresAt: true,
              denialReason: true,
              provenance: true,
              member: {
                select: {
                  connection: {
                    select: {
                      status: true,
                      configuration: true,
                    },
                  },
                },
              },
              agreement: {
                select: {
                  status: true,
                  signedAt: true,
                },
              },
              provisionalDecision: true,
            },
          });

          if (!authorization) {
            throw new NotFoundException('Autorizacao de visita nao encontrada');
          }

          if (authorization.provisionalDecision) {
            return authorization.provisionalDecision;
          }

          const policy = parseProvisionalAccessPolicy(
            authorization.member.connection.configuration,
          );

          if (policy.state !== 'ENABLED') {
            return this.recordDeniedDecision(tx, {
              visitAuthorizationId: authorization.id,
              gymId: tenantId,
              actorUserId: operatorId,
              policyVersion: null,
              reason:
                policy.state === 'INVALID'
                  ? 'PROVISIONAL_POLICY_INVALID'
                  : 'PROVISIONAL_POLICY_DISABLED',
              metadata: {
                decisionVersion: DECISION_VERSION,
              },
            });
          }

          const policyMetadata: Record<string, string | number> = {
            decisionVersion: DECISION_VERSION,
            maxDurationMinutes: policy.maxDurationMinutes,
            eligibilityLookbackMinutes: policy.eligibilityLookbackMinutes,
            maxRevalidationAttempts: policy.maxRevalidationAttempts,
          };

          if (
            authorization.status !== AggregatorVisitStatus.DENIED ||
            authorization.denialReason !== 'ELIGIBILITY_UNKNOWN'
          ) {
            return this.recordDeniedDecision(tx, {
              visitAuthorizationId: authorization.id,
              gymId: tenantId,
              actorUserId: operatorId,
              policyVersion: policy.version,
              reason: 'PROVISIONAL_TARGET_NOT_ELIGIBILITY_UNKNOWN',
              metadata: policyMetadata,
            });
          }

          if (
            authorization.member.connection.status !==
            AggregatorConnectionStatus.ACTIVE
          ) {
            return this.recordDeniedDecision(tx, {
              visitAuthorizationId: authorization.id,
              gymId: tenantId,
              actorUserId: operatorId,
              policyVersion: policy.version,
              reason: 'PROVISIONAL_PROVIDER_CONNECTION_NOT_ACTIVE',
              metadata: policyMetadata,
            });
          }

          if (
            authorization.agreement?.status !== AggregatorAgreementStatus.SIGNED ||
            !authorization.agreement.signedAt
          ) {
            return this.recordDeniedDecision(tx, {
              visitAuthorizationId: authorization.id,
              gymId: tenantId,
              actorUserId: operatorId,
              policyVersion: policy.version,
              reason: 'PROVISIONAL_AGREEMENT_NOT_SIGNED',
              metadata: policyMetadata,
            });
          }

          const latestEligibility = await tx.aggregatorEligibilityCheck.findFirst({
            where: { memberId: authorization.memberId },
            orderBy: [{ verifiedAt: 'desc' }, { createdAt: 'desc' }],
            select: {
              id: true,
              status: true,
              reasonCode: true,
              verifiedAt: true,
              validUntil: true,
              createdAt: true,
            },
          });

          if (
            !latestEligibility ||
            latestEligibility.status !== AggregatorEligibilityStatus.UNKNOWN ||
            !isTransientProviderFailure(latestEligibility.reasonCode)
          ) {
            return this.recordDeniedDecision(tx, {
              visitAuthorizationId: authorization.id,
              gymId: tenantId,
              actorUserId: operatorId,
              policyVersion: policy.version,
              reason: 'PROVISIONAL_UNKNOWN_NOT_TRANSIENT_PROVIDER_FAILURE',
              metadata: policyMetadata,
            });
          }

          const now = new Date();
          const lookback = new Date(
            now.getTime() - policy.eligibilityLookbackMinutes * 60_000,
          );
          const priorEligible = await tx.aggregatorEligibilityCheck.findFirst({
            where: {
              memberId: authorization.memberId,
              status: AggregatorEligibilityStatus.ELIGIBLE,
              verifiedAt: { gte: lookback, lte: now },
              validUntil: { not: null },
            },
            orderBy: [{ verifiedAt: 'desc' }, { createdAt: 'desc' }],
            select: {
              id: true,
              verifiedAt: true,
              validUntil: true,
            },
          });

          if (!priorEligible) {
            return this.recordDeniedDecision(tx, {
              visitAuthorizationId: authorization.id,
              gymId: tenantId,
              actorUserId: operatorId,
              policyVersion: policy.version,
              reason: 'PROVISIONAL_NO_RECENT_ELIGIBLE_EVIDENCE',
              metadata: {
                ...policyMetadata,
                latestUnknownCheckId: latestEligibility.id,
              },
            });
          }

          const expiresAt = new Date(
            now.getTime() + policy.maxDurationMinutes * 60_000,
          );
          const decision = await tx.aggregatorProvisionalDecision.create({
            data: {
              visitAuthorizationId: authorization.id,
              status: AggregatorProvisionalDecisionStatus.APPROVED,
              policyVersion: policy.version,
              reason: 'TRANSIENT_PROVIDER_FAILURE_WITH_RECENT_ELIGIBILITY',
              authorizedByUserId: operatorId,
              expiresAt,
              metadata: {
                ...policyMetadata,
                latestUnknownCheckId: latestEligibility.id,
                latestUnknownReasonCode: latestEligibility.reasonCode,
                priorEligibleCheckId: priorEligible.id,
                priorEligibleVerifiedAt: priorEligible.verifiedAt.toISOString(),
                priorEligibleValidUntil: priorEligible.validUntil?.toISOString(),
              },
            },
          });

          const updatedAuthorization =
            await tx.aggregatorVisitAuthorization.update({
              where: { id: authorization.id },
              data: {
                status: AggregatorVisitStatus.PROVISIONAL,
                authorizedAt: now,
                expiresAt,
                denialReason: null,
                provenance: mergeJsonObject(authorization.provenance, {
                  provisionalDecisionVersion: DECISION_VERSION,
                  provisionalDecisionId: decision.id,
                  provisionalPolicyVersion: policy.version,
                  provisionalDecidedAt: now.toISOString(),
                }),
              },
            });

          await this.audit.record(
            {
              gymId: tenantId,
              userId: operatorId,
              action: 'AGGREGATOR_PROVISIONAL_ACCESS_APPROVED',
              entity: 'AggregatorProvisionalDecision',
              entityId: decision.id,
              next: {
                visitAuthorizationId: decision.visitAuthorizationId,
                status: decision.status,
                policyVersion: decision.policyVersion,
                reason: decision.reason,
                expiresAt: decision.expiresAt,
              },
            },
            tx,
          );

          await this.audit.record(
            {
              gymId: tenantId,
              userId: operatorId,
              action: 'AGGREGATOR_VISIT_MARKED_PROVISIONAL',
              entity: 'AggregatorVisitAuthorization',
              entityId: authorization.id,
              previous: {
                status: authorization.status,
                authorizedAt: authorization.authorizedAt,
                expiresAt: authorization.expiresAt,
                denialReason: authorization.denialReason,
              },
              next: {
                status: updatedAuthorization.status,
                authorizedAt: updatedAuthorization.authorizedAt,
                expiresAt: updatedAuthorization.expiresAt,
                denialReason: updatedAuthorization.denialReason,
              },
            },
            tx,
          );

          return decision;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async revalidate(
    visitAuthorizationId: string,
    gymId?: string,
    actorUserId?: string,
  ) {
    const tenantId = this.requireGym(gymId);

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const authorization = await tx.aggregatorVisitAuthorization.findFirst({
            where: {
              id: visitAuthorizationId,
              member: { connection: { gymId: tenantId } },
            },
            select: {
              id: true,
              memberId: true,
              status: true,
              authorizedAt: true,
              expiresAt: true,
              denialReason: true,
              provenance: true,
              provisionalDecision: true,
            },
          });

          if (!authorization) {
            throw new NotFoundException('Autorizacao de visita nao encontrada');
          }

          const decision = authorization.provisionalDecision;
          if (
            authorization.status !== AggregatorVisitStatus.PROVISIONAL ||
            !decision ||
            decision.status !== AggregatorProvisionalDecisionStatus.APPROVED
          ) {
            throw new ConflictException('Visita nao esta em estado provisório revalidavel');
          }

          const snapshot = readPolicySnapshot(decision.metadata);
          if (!snapshot || !decision.expiresAt) {
            throw new ConflictException('Snapshot da politica provisória invalido');
          }

          const now = new Date();
          const previousAttempts = await tx.aggregatorRevalidationAttempt.count({
            where: { visitAuthorizationId: authorization.id },
          });

          if (
            decision.expiresAt.getTime() <= now.getTime() ||
            previousAttempts >= snapshot.maxRevalidationAttempts
          ) {
            const expiredDecision = await tx.aggregatorProvisionalDecision.update({
              where: { id: decision.id },
              data: { status: AggregatorProvisionalDecisionStatus.EXPIRED },
            });
            const failedVisit = await tx.aggregatorVisitAuthorization.update({
              where: { id: authorization.id },
              data: {
                status: AggregatorVisitStatus.FAILED,
                denialReason:
                  decision.expiresAt.getTime() <= now.getTime()
                    ? 'PROVISIONAL_WINDOW_EXPIRED'
                    : 'REVALIDATION_ATTEMPTS_EXHAUSTED',
              },
            });

            await this.audit.record(
              {
                gymId: tenantId,
                userId: actorUserId ?? null,
                action: 'AGGREGATOR_PROVISIONAL_ACCESS_EXPIRED',
                entity: 'AggregatorProvisionalDecision',
                entityId: expiredDecision.id,
                previous: { status: decision.status },
                next: { status: expiredDecision.status },
              },
              tx,
            );

            return {
              authorization: failedVisit,
              decision: expiredDecision,
              attempt: null,
            };
          }

          const latestFreshCheck = await tx.aggregatorEligibilityCheck.findFirst({
            where: {
              memberId: authorization.memberId,
              createdAt: { gte: decision.createdAt },
            },
            orderBy: [{ verifiedAt: 'desc' }, { createdAt: 'desc' }],
            select: {
              id: true,
              externalCheckId: true,
              status: true,
              reasonCode: true,
              verifiedAt: true,
              validUntil: true,
              createdAt: true,
            },
          });

          const evaluation = evaluateEligibilityEvidence(latestFreshCheck, now);
          const attemptNumber = previousAttempts + 1;

          if (evaluation.status === AggregatorEligibilityStatus.ELIGIBLE) {
            const attempt = await tx.aggregatorRevalidationAttempt.create({
              data: {
                visitAuthorizationId: authorization.id,
                attempt: attemptNumber,
                status: AggregatorRevalidationStatus.CONFIRMED,
                externalCheckId: latestFreshCheck?.externalCheckId ?? null,
                reasonCode: null,
                provenance: {
                  source: 'AGG6_REVALIDATION',
                  decisionVersion: DECISION_VERSION,
                  eligibilityCheckId: evaluation.checkId,
                },
                completedAt: now,
              },
            });

            const confirmed = await tx.aggregatorVisitAuthorization.update({
              where: { id: authorization.id },
              data: {
                status: AggregatorVisitStatus.CONFIRMED,
                eligibilityCheckId: evaluation.checkId,
                expiresAt: evaluation.validUntil,
                denialReason: null,
                provenance: mergeJsonObject(authorization.provenance, {
                  revalidatedBy: DECISION_VERSION,
                  revalidationAttemptId: attempt.id,
                  revalidatedAt: now.toISOString(),
                }),
              },
            });

            await this.audit.record(
              {
                gymId: tenantId,
                userId: actorUserId ?? null,
                action: 'AGGREGATOR_PROVISIONAL_REVALIDATION_CONFIRMED',
                entity: 'AggregatorRevalidationAttempt',
                entityId: attempt.id,
                next: {
                  visitAuthorizationId: authorization.id,
                  attempt: attempt.attempt,
                  status: attempt.status,
                  eligibilityCheckId: evaluation.checkId,
                },
              },
              tx,
            );

            return { authorization: confirmed, decision, attempt };
          }

          if (evaluation.status === AggregatorEligibilityStatus.INELIGIBLE) {
            const attempt = await tx.aggregatorRevalidationAttempt.create({
              data: {
                visitAuthorizationId: authorization.id,
                attempt: attemptNumber,
                status: AggregatorRevalidationStatus.FAILED,
                externalCheckId: latestFreshCheck?.externalCheckId ?? null,
                reasonCode: evaluation.reasonCode ?? 'ELIGIBILITY_INELIGIBLE',
                provenance: {
                  source: 'AGG6_REVALIDATION',
                  decisionVersion: DECISION_VERSION,
                  eligibilityCheckId: evaluation.checkId,
                },
                completedAt: now,
              },
            });
            const revoked = await tx.aggregatorProvisionalDecision.update({
              where: { id: decision.id },
              data: { status: AggregatorProvisionalDecisionStatus.REVOKED },
            });
            const failed = await tx.aggregatorVisitAuthorization.update({
              where: { id: authorization.id },
              data: {
                status: AggregatorVisitStatus.FAILED,
                eligibilityCheckId: evaluation.checkId,
                denialReason: 'REVALIDATION_INELIGIBLE',
                provenance: mergeJsonObject(authorization.provenance, {
                  revalidatedBy: DECISION_VERSION,
                  revalidationAttemptId: attempt.id,
                  revalidationFailedAt: now.toISOString(),
                }),
              },
            });

            await this.audit.record(
              {
                gymId: tenantId,
                userId: actorUserId ?? null,
                action: 'AGGREGATOR_PROVISIONAL_REVALIDATION_FAILED',
                entity: 'AggregatorRevalidationAttempt',
                entityId: attempt.id,
                next: {
                  visitAuthorizationId: authorization.id,
                  attempt: attempt.attempt,
                  status: attempt.status,
                  reasonCode: attempt.reasonCode,
                  provisionalStatus: revoked.status,
                },
              },
              tx,
            );

            return { authorization: failed, decision: revoked, attempt };
          }

          const reasonCode = latestFreshCheck
            ? evaluation.reasonCode ?? 'ELIGIBILITY_UNKNOWN'
            : 'NO_FRESH_REVALIDATION_EVIDENCE';
          const attempt = await tx.aggregatorRevalidationAttempt.create({
            data: {
              visitAuthorizationId: authorization.id,
              attempt: attemptNumber,
              status: AggregatorRevalidationStatus.UNKNOWN,
              externalCheckId: latestFreshCheck?.externalCheckId ?? null,
              reasonCode,
              provenance: {
                source: 'AGG6_REVALIDATION',
                decisionVersion: DECISION_VERSION,
                ...(evaluation.checkId
                  ? { eligibilityCheckId: evaluation.checkId }
                  : {}),
              },
              completedAt: now,
            },
          });

          let currentDecision = decision;
          let currentAuthorization: any = authorization;
          if (attemptNumber >= snapshot.maxRevalidationAttempts) {
            currentDecision = await tx.aggregatorProvisionalDecision.update({
              where: { id: decision.id },
              data: { status: AggregatorProvisionalDecisionStatus.EXPIRED },
            });
            currentAuthorization = await tx.aggregatorVisitAuthorization.update({
              where: { id: authorization.id },
              data: {
                status: AggregatorVisitStatus.FAILED,
                denialReason: 'REVALIDATION_ATTEMPTS_EXHAUSTED',
              },
            });
          }

          await this.audit.record(
            {
              gymId: tenantId,
              userId: actorUserId ?? null,
              action: 'AGGREGATOR_PROVISIONAL_REVALIDATION_UNKNOWN',
              entity: 'AggregatorRevalidationAttempt',
              entityId: attempt.id,
              next: {
                visitAuthorizationId: authorization.id,
                attempt: attempt.attempt,
                status: attempt.status,
                reasonCode: attempt.reasonCode,
                provisionalStatus: currentDecision.status,
                visitStatus: currentAuthorization.status,
              },
            },
            tx,
          );

          return {
            authorization: currentAuthorization,
            decision: currentDecision,
            attempt,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }
}
