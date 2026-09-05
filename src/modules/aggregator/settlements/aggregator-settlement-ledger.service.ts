import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AggregatorSettlementStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';

const MAX_SERIALIZABLE_RETRIES = 3;

export interface RecordAggregatorSettlementInput {
  connectionId: string;
  externalSettlementId: string;
  externalVisitId?: string;
  status: AggregatorSettlementStatus;
  amountExpected?: number;
  amountConfirmed?: number;
  currency?: string;
  periodStart?: string | Date;
  periodEnd?: string | Date;
  providerStatus?: string;
  evidenceRef?: string;
}

function toDate(value?: string | Date) {
  return value ? new Date(value) : undefined;
}

@Injectable()
export class AggregatorSettlementLedgerService {
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

    throw new ConflictException('Falha de concorrencia no settlement ledger');
  }

  async recordProviderSettlement(
    input: RecordAggregatorSettlementInput,
    gymId?: string,
    actorUserId?: string,
  ) {
    const tenantId = this.requireGym(gymId);
    const periodStart = toDate(input.periodStart);
    const periodEnd = toDate(input.periodEnd);

    if (periodStart && periodEnd && periodEnd < periodStart) {
      throw new BadRequestException('Periodo de settlement invalido');
    }

    if (
      (input.amountExpected !== undefined || input.amountConfirmed !== undefined) &&
      !input.currency
    ) {
      throw new BadRequestException('Moeda obrigatoria quando houver valor financeiro');
    }

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const connection = await tx.aggregatorProviderConnection.findFirst({
            where: { id: input.connectionId, gymId: tenantId },
            select: { id: true, providerCode: true },
          });

          if (!connection) {
            throw new NotFoundException('Conexao de aggregator nao encontrada');
          }

          let matchedVisitId: string | null = null;
          if (input.externalVisitId) {
            const visit = await tx.aggregatorVisitAuthorization.findFirst({
              where: {
                externalVisitId: input.externalVisitId,
                member: { connectionId: connection.id },
              },
              select: { id: true },
            });
            matchedVisitId = visit?.id ?? null;
          }

          const existing = await tx.aggregatorSettlement.findUnique({
            where: {
              connectionId_externalSettlementId: {
                connectionId: connection.id,
                externalSettlementId: input.externalSettlementId,
              },
            },
          });

          if (existing) {
            if (
              existing.externalVisitId &&
              input.externalVisitId &&
              existing.externalVisitId !== input.externalVisitId
            ) {
              throw new ConflictException(
                'Settlement externo ja vinculado a outra visita externa',
              );
            }
            if (
              existing.visitAuthorizationId &&
              matchedVisitId &&
              existing.visitAuthorizationId !== matchedVisitId
            ) {
              throw new ConflictException(
                'Settlement externo ja vinculado a outra autorizacao',
              );
            }
            if (
              existing.currency &&
              input.currency &&
              existing.currency !== input.currency
            ) {
              throw new ConflictException('Moeda do settlement nao pode ser alterada');
            }

            const updated = await tx.aggregatorSettlement.update({
              where: { id: existing.id },
              data: {
                visitAuthorizationId:
                  existing.visitAuthorizationId ?? matchedVisitId ?? undefined,
                externalVisitId:
                  input.externalVisitId ?? existing.externalVisitId ?? undefined,
                status: input.status,
                amountExpected: input.amountExpected,
                amountConfirmed: input.amountConfirmed,
                currency: input.currency,
                periodStart,
                periodEnd,
                providerStatus: input.providerStatus,
                provenance: {
                  source: 'AGG7_SETTLEMENT_LEDGER',
                  providerCode: connection.providerCode,
                  ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
                },
              },
            });

            await this.audit.record(
              {
                gymId: tenantId,
                userId: actorUserId ?? null,
                action: 'AGGREGATOR_SETTLEMENT_EVIDENCE_UPDATED',
                entity: 'AggregatorSettlement',
                entityId: updated.id,
                previous: {
                  status: existing.status,
                  amountExpected: existing.amountExpected,
                  amountConfirmed: existing.amountConfirmed,
                  currency: existing.currency,
                  visitAuthorizationId: existing.visitAuthorizationId,
                },
                next: {
                  status: updated.status,
                  amountExpected: updated.amountExpected,
                  amountConfirmed: updated.amountConfirmed,
                  currency: updated.currency,
                  visitAuthorizationId: updated.visitAuthorizationId,
                },
              },
              tx,
            );

            return updated;
          }

          const created = await tx.aggregatorSettlement.create({
            data: {
              connectionId: connection.id,
              visitAuthorizationId: matchedVisitId,
              externalSettlementId: input.externalSettlementId,
              externalVisitId: input.externalVisitId,
              status: input.status,
              amountExpected: input.amountExpected,
              amountConfirmed: input.amountConfirmed,
              currency: input.currency,
              periodStart,
              periodEnd,
              providerStatus: input.providerStatus,
              provenance: {
                source: 'AGG7_SETTLEMENT_LEDGER',
                providerCode: connection.providerCode,
                ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
              },
            },
          });

          await this.audit.record(
            {
              gymId: tenantId,
              userId: actorUserId ?? null,
              action: 'AGGREGATOR_SETTLEMENT_EVIDENCE_RECORDED',
              entity: 'AggregatorSettlement',
              entityId: created.id,
              next: {
                connectionId: created.connectionId,
                visitAuthorizationId: created.visitAuthorizationId,
                externalSettlementId: created.externalSettlementId,
                externalVisitId: created.externalVisitId,
                status: created.status,
                amountExpected: created.amountExpected,
                amountConfirmed: created.amountConfirmed,
                currency: created.currency,
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
}
