import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FiscalHandoffStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthSecurityService } from '../auth/auth-security.service';
import { CancelFiscalHandoffDto } from './dto/cancel-fiscal-handoff.dto';
import {
  FiscalBridgeHttpTransport,
  FiscalBridgeTransportError,
} from './fiscal-bridge.contract';
import { FiscalBridgeDispatchService } from './fiscal-bridge-dispatch.service';
import { buildFiscalOperation } from './fiscal-bridge-payload';

const J4_BATCH_SIZE = 20;
const J4_LEASE_MS = 2 * 60_000;
const J4_RETRY_MS = 15 * 60_000;
const CANCELLATION_QUERY_RETRY_MS = 60_000;

function safeErrorCode(error: unknown): string {
  if (error instanceof FiscalBridgeTransportError) {
    return error.code.slice(0, 128);
  }
  if (
    error instanceof ServiceUnavailableException &&
    typeof error.message === 'string'
  ) {
    return 'FISCAL_J4_CONFIGURATION_UNAVAILABLE';
  }
  return 'FISCAL_J4_OPERATION_FAILED';
}

function boundedJustification(raw: string): string {
  const value = raw.trim();
  if (value.length < 15 || value.length > 255) {
    throw new ConflictException(
      'Justificativa fiscal deve ter entre 15 e 255 caracteres',
    );
  }
  return value;
}

@Injectable()
export class FiscalReconciliationCancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authSecurity: AuthSecurityService,
    private readonly dispatch: FiscalBridgeDispatchService,
    private readonly http: FiscalBridgeHttpTransport,
    private readonly audit: AuditService,
  ) {}

  async listTenantHandoffs(gymId: string, status?: string) {
    let normalizedStatus: FiscalHandoffStatus | undefined;
    if (status?.trim()) {
      const candidate = status.trim().toUpperCase();
      if (!Object.values(FiscalHandoffStatus).includes(candidate as FiscalHandoffStatus)) {
        throw new ConflictException('Status fiscal invalido');
      }
      normalizedStatus = candidate as FiscalHandoffStatus;
    }

    return this.prisma.fiscalHandoff.findMany({
      where: {
        gymId,
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
      select: {
        id: true,
        chargeId: true,
        status: true,
        documentKind: true,
        operationKind: true,
        amountMinor: true,
        currency: true,
        paymentMethod: true,
        settledAt: true,
        providerDocumentId: true,
        attemptCount: true,
        nextAttemptAt: true,
        lastAttemptAt: true,
        lastErrorCode: true,
        authorizedAt: true,
        reconciledAt: true,
        cancelledAt: true,
        cancellationRejectionCode: true,
        cancellationRejectionMessage: true,
        reconciliationIssueCodes: true,
        createdAt: true,
        updatedAt: true,
        charge: {
          select: {
            student: {
              select: {
                id: true,
                user: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  private async scheduleReconciliationRetry(
    row: any,
    leaseOwner: string,
    code: string,
  ) {
    await this.prisma.fiscalHandoff.updateMany({
      where: {
        id: row.id,
        dispatchLeaseOwner: leaseOwner,
        status: FiscalHandoffStatus.RECONCILIATION_PENDING,
      },
      data: {
        nextAttemptAt: new Date(Date.now() + J4_RETRY_MS),
        dispatchLeaseOwner: null,
        dispatchLeaseUntil: null,
        lastErrorCode: code.slice(0, 128),
      },
    });
  }

  private async reconcileClaimed(
    row: any,
    leaseOwner: string,
  ) {
    try {
      const resolved = await this.dispatch.resolveBridgeContext(
        row.gymId,
      );
      const correlationId = randomUUID();
      const payload = await this.http.post(
        '/v1/reconciliations',
        {
          operation: buildFiscalOperation(row),
        },
        resolved.context,
        correlationId,
        row.idempotencyKey + ':reconcile',
      );
      const result = this.http.parseReconciliation(payload);

      if (
        result.operationReference.type !== 'iron_charge' ||
        result.operationReference.id !== row.chargeId
      ) {
        await this.prisma.fiscalHandoff.updateMany({
          where: {
            id: row.id,
            dispatchLeaseOwner: leaseOwner,
          },
          data: {
            status: FiscalHandoffStatus.FAILED,
            nextAttemptAt: null,
            dispatchLeaseOwner: null,
            dispatchLeaseUntil: null,
            lastErrorCode:
              'FISCAL_RECONCILIATION_REFERENCE_MISMATCH',
            reconciliationFingerprint: result.fingerprint,
            reconciliationIssueCodes: result.issues.map(
              (issue) => issue.code,
            ),
          },
        });
        return false;
      }

      if (result.status === 'pending') {
        await this.prisma.fiscalHandoff.updateMany({
          where: {
            id: row.id,
            dispatchLeaseOwner: leaseOwner,
          },
          data: {
            status:
              FiscalHandoffStatus.RECONCILIATION_PENDING,
            nextAttemptAt: new Date(
              Date.now() + J4_RETRY_MS,
            ),
            dispatchLeaseOwner: null,
            dispatchLeaseUntil: null,
            lastErrorCode: null,
            reconciliationFingerprint: result.fingerprint,
            reconciliationIssueCodes: result.issues.map(
              (issue) => issue.code,
            ),
          },
        });
        return false;
      }

      if (
        result.status === 'divergent' ||
        !result.selectedDocumentId
      ) {
        await this.prisma.fiscalHandoff.updateMany({
          where: {
            id: row.id,
            dispatchLeaseOwner: leaseOwner,
          },
          data: {
            status: FiscalHandoffStatus.FAILED,
            nextAttemptAt: null,
            dispatchLeaseOwner: null,
            dispatchLeaseUntil: null,
            lastErrorCode:
              result.status === 'divergent'
                ? 'FISCAL_RECONCILIATION_DIVERGENT'
                : 'FISCAL_RECONCILIATION_DOCUMENT_MISSING',
            reconciliationFingerprint: result.fingerprint,
            reconciliationIssueCodes: result.issues.map(
              (issue) => issue.code,
            ),
          },
        });
        return false;
      }

      if (
        row.providerDocumentId &&
        row.providerDocumentId !== result.selectedDocumentId
      ) {
        await this.prisma.fiscalHandoff.updateMany({
          where: {
            id: row.id,
            dispatchLeaseOwner: leaseOwner,
          },
          data: {
            status: FiscalHandoffStatus.FAILED,
            nextAttemptAt: null,
            dispatchLeaseOwner: null,
            dispatchLeaseUntil: null,
            lastErrorCode:
              'FISCAL_RECONCILIATION_DOCUMENT_CONFLICT',
            reconciliationFingerprint: result.fingerprint,
            reconciliationIssueCodes: result.issues.map(
              (issue) => issue.code,
            ),
          },
        });
        return false;
      }

      const reconciledAt = new Date();
      const updated =
        await this.prisma.fiscalHandoff.updateMany({
          where: {
            id: row.id,
            dispatchLeaseOwner: leaseOwner,
            status:
              FiscalHandoffStatus.RECONCILIATION_PENDING,
          },
          data: {
            status: FiscalHandoffStatus.RECONCILED,
            providerDocumentId: result.selectedDocumentId,
            bridgeConnectionId: resolved.connectionId,
            reconciledAt,
            nextAttemptAt: null,
            dispatchLeaseOwner: null,
            dispatchLeaseUntil: null,
            lastErrorCode: null,
            reconciliationFingerprint: result.fingerprint,
            reconciliationIssueCodes: result.issues.map(
              (issue) => issue.code,
            ),
          },
        });
      if (updated.count !== 1) return false;

      await this.audit.record({
        gymId: row.gymId,
        action: 'FISCAL_RECONCILIATION_MATCHED',
        entity: 'FiscalHandoff',
        entityId: row.id,
        next: {
          selectedDocumentId: result.selectedDocumentId,
          fingerprint: result.fingerprint,
          issueCodes: result.issues.map(
            (issue) => issue.code,
          ),
          reconciledAt,
        },
      });

      return true;
    } catch (error) {
      await this.scheduleReconciliationRetry(
        row,
        leaseOwner,
        safeErrorCode(error),
      );
      return false;
    }
  }

  async reconcileDue(limit = J4_BATCH_SIZE) {
    const now = new Date();
    const rows = await this.prisma.fiscalHandoff.findMany({
      where: {
        status: FiscalHandoffStatus.RECONCILIATION_PENDING,
        AND: [
          {
            OR: [
              { nextAttemptAt: null },
              { nextAttemptAt: { lte: now } },
            ],
          },
          {
            OR: [
              { dispatchLeaseUntil: null },
              { dispatchLeaseUntil: { lte: now } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    let reconciled = 0;
    for (const row of rows) {
      const leaseOwner = randomUUID();
      const claimed =
        await this.prisma.fiscalHandoff.updateMany({
          where: {
            id: row.id,
            status:
              FiscalHandoffStatus.RECONCILIATION_PENDING,
            OR: [
              { dispatchLeaseUntil: null },
              { dispatchLeaseUntil: { lte: new Date() } },
            ],
          },
          data: {
            dispatchLeaseOwner: leaseOwner,
            dispatchLeaseUntil: new Date(
              Date.now() + J4_LEASE_MS,
            ),
            lastAttemptAt: new Date(),
            attemptCount: { increment: 1 },
          },
        });
      if (claimed.count !== 1) continue;
      if (await this.reconcileClaimed(row, leaseOwner)) {
        reconciled += 1;
      }
    }

    return {
      scanned: rows.length,
      reconciled,
    };
  }

  async requestCancellation(
    handoffId: string,
    gymId: string,
    userId: string,
    dto: CancelFiscalHandoffDto,
  ) {
    await this.authSecurity.assertStepUp(
      userId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );
    const justification = boundedJustification(
      dto.justification,
    );
    const row = await this.prisma.fiscalHandoff.findFirst({
      where: {
        id: handoffId,
        gymId,
      },
    });
    if (!row) {
      throw new ConflictException(
        'Fiscal handoff nao encontrado no tenant ativo',
      );
    }

    if (row.status === FiscalHandoffStatus.CANCELLED) {
      return {
        id: row.id,
        status: row.status,
        idempotent: true,
      };
    }
    if (
      row.status ===
      FiscalHandoffStatus.CANCELLATION_PENDING
    ) {
      return {
        id: row.id,
        status: row.status,
        idempotent: true,
      };
    }
    if (
      row.status !== FiscalHandoffStatus.AUTHORIZED &&
      row.status !== FiscalHandoffStatus.RECONCILED
    ) {
      throw new ConflictException(
        'Fiscal handoff nao esta em estado cancelavel',
      );
    }
    if (
      !row.providerAccessKey ||
      !row.providerProtocolReference
    ) {
      throw new ConflictException(
        'Documento fiscal sem access key/protocolo para cancelamento',
      );
    }

    const previousStatus = row.status;
    const resolved = await this.dispatch.resolveBridgeContext(
      gymId,
    );
    const correlationId = randomUUID();

    const reserved =
      await this.prisma.fiscalHandoff.updateMany({
        where: {
          id: row.id,
          gymId,
          status: previousStatus,
        },
        data: {
          status:
            FiscalHandoffStatus.CANCELLATION_PENDING,
          bridgeConnectionId: resolved.connectionId,
          cancellationJustification: justification,
          lastAttemptAt: new Date(),
          lastErrorCode: null,
        },
      });
    if (reserved.count !== 1) {
      throw new ConflictException(
        'Estado fiscal mudou durante solicitacao de cancelamento',
      );
    }

    try {
      const payload = await this.http.post(
        '/v1/cancellations',
        {
          access_key: row.providerAccessKey,
          authorization_protocol:
            row.providerProtocolReference,
          justification,
        },
        resolved.context,
        correlationId,
        row.idempotencyKey + ':cancel',
      );
      const result = this.http.parseCancellation(payload);

      if (result.accessKey !== row.providerAccessKey) {
        throw new FiscalBridgeTransportError(
          'FISCAL_CANCELLATION_ACCESS_KEY_MISMATCH',
          true,
        );
      }

      const rejected = result.status === 'rejected';
      const nextAttemptAt = rejected
        ? null
        : new Date(
            Date.now() + CANCELLATION_QUERY_RETRY_MS,
          );

      await this.prisma.fiscalHandoff.updateMany({
        where: {
          id: row.id,
          status:
            FiscalHandoffStatus.CANCELLATION_PENDING,
        },
        data: {
          status: rejected
            ? previousStatus
            : FiscalHandoffStatus.CANCELLATION_PENDING,
          cancellationRequestId: result.requestId,
          cancellationProtocolReference:
            result.eventProtocolReference,
          cancellationRejectionCode:
            result.rejectionCode,
          cancellationRejectionMessage:
            result.rejectionMessage,
          nextAttemptAt,
          lastErrorCode: rejected
            ? 'FISCAL_CANCELLATION_REJECTED'
            : null,
        },
      });

      await this.audit.record({
        gymId,
        userId,
        action: rejected
          ? 'FISCAL_CANCELLATION_REJECTED'
          : 'FISCAL_CANCELLATION_REQUESTED',
        entity: 'FiscalHandoff',
        entityId: row.id,
        next: {
          requestId: result.requestId,
          status: result.status,
          eventProtocolReference:
            result.eventProtocolReference,
          rejectionCode: result.rejectionCode,
        },
      });

      return {
        id: row.id,
        status: rejected
          ? previousStatus
          : FiscalHandoffStatus.CANCELLATION_PENDING,
        providerStatus: result.status,
        idempotent: false,
      };
    } catch (error) {
      await this.prisma.fiscalHandoff.updateMany({
        where: {
          id: row.id,
          status:
            FiscalHandoffStatus.CANCELLATION_PENDING,
        },
        data: {
          nextAttemptAt: new Date(
            Date.now() + CANCELLATION_QUERY_RETRY_MS,
          ),
          lastErrorCode: safeErrorCode(error),
        },
      });
      throw new ServiceUnavailableException(
        'Cancelamento fiscal ficou pendente de confirmacao',
      );
    }
  }

  private async resumeCancellation(row: any) {
    if (!row.providerAccessKey) {
      await this.prisma.fiscalHandoff.updateMany({
        where: { id: row.id },
        data: {
          status: FiscalHandoffStatus.FAILED,
          nextAttemptAt: null,
          lastErrorCode:
            'FISCAL_CANCELLATION_ACCESS_KEY_MISSING',
        },
      });
      return false;
    }

    const resolved = await this.dispatch.resolveBridgeContext(
      row.gymId,
    );
    const correlationId = randomUUID();

    try {
      const queryPayload = await this.http.post(
        '/v1/queries',
        { access_key: row.providerAccessKey },
        resolved.context,
        correlationId,
      );
      const query = this.http.parseQuery(queryPayload);

      if (query.accessKey !== row.providerAccessKey) {
        throw new FiscalBridgeTransportError(
          'FISCAL_QUERY_ACCESS_KEY_MISMATCH',
          false,
        );
      }

      if (query.status === 'cancelled') {
        const cancelledAt = new Date();
        await this.prisma.fiscalHandoff.updateMany({
          where: {
            id: row.id,
            status:
              FiscalHandoffStatus.CANCELLATION_PENDING,
          },
          data: {
            status: FiscalHandoffStatus.CANCELLED,
            cancelledAt,
            providerProtocolReference:
              query.protocolReference ??
              row.providerProtocolReference,
            nextAttemptAt: null,
            lastErrorCode: null,
          },
        });
        await this.audit.record({
          gymId: row.gymId,
          action: 'FISCAL_DOCUMENT_CANCELLED',
          entity: 'FiscalHandoff',
          entityId: row.id,
          next: {
            cancelledAt,
            accessKey: '[REDACTED]',
          },
        });
        return true;
      }

      if (query.status === 'not_found') {
        await this.prisma.fiscalHandoff.updateMany({
          where: { id: row.id },
          data: {
            status: FiscalHandoffStatus.FAILED,
            nextAttemptAt: null,
            lastErrorCode:
              'FISCAL_CANCELLATION_DOCUMENT_NOT_FOUND',
          },
        });
        return false;
      }

      if (
        query.status === 'authorized' &&
        row.cancellationJustification &&
        row.providerProtocolReference
      ) {
        const cancellationPayload = await this.http.post(
          '/v1/cancellations',
          {
            access_key: row.providerAccessKey,
            authorization_protocol:
              row.providerProtocolReference,
            justification: row.cancellationJustification,
          },
          resolved.context,
          correlationId,
          row.idempotencyKey + ':cancel',
        );
        const cancellation =
          this.http.parseCancellation(
            cancellationPayload,
          );

        if (
          cancellation.accessKey !==
          row.providerAccessKey
        ) {
          throw new FiscalBridgeTransportError(
            'FISCAL_CANCELLATION_ACCESS_KEY_MISMATCH',
            true,
          );
        }

        if (cancellation.status === 'rejected') {
          await this.prisma.fiscalHandoff.updateMany({
            where: { id: row.id },
            data: {
              status: FiscalHandoffStatus.AUTHORIZED,
              cancellationRequestId:
                cancellation.requestId,
              cancellationProtocolReference:
                cancellation.eventProtocolReference,
              cancellationRejectionCode:
                cancellation.rejectionCode,
              cancellationRejectionMessage:
                cancellation.rejectionMessage,
              nextAttemptAt: null,
              lastErrorCode:
                'FISCAL_CANCELLATION_REJECTED',
            },
          });
          return false;
        }
      }

      await this.prisma.fiscalHandoff.updateMany({
        where: {
          id: row.id,
          status:
            FiscalHandoffStatus.CANCELLATION_PENDING,
        },
        data: {
          nextAttemptAt: new Date(
            Date.now() + CANCELLATION_QUERY_RETRY_MS,
          ),
          lastErrorCode: null,
        },
      });
      return false;
    } catch (error) {
      await this.prisma.fiscalHandoff.updateMany({
        where: {
          id: row.id,
          status:
            FiscalHandoffStatus.CANCELLATION_PENDING,
        },
        data: {
          nextAttemptAt: new Date(
            Date.now() + CANCELLATION_QUERY_RETRY_MS,
          ),
          lastErrorCode: safeErrorCode(error),
        },
      });
      return false;
    }
  }

  async resumeCancellations(limit = J4_BATCH_SIZE) {
    const now = new Date();
    const rows = await this.prisma.fiscalHandoff.findMany({
      where: {
        status:
          FiscalHandoffStatus.CANCELLATION_PENDING,
        OR: [
          { nextAttemptAt: null },
          { nextAttemptAt: { lte: now } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    let cancelled = 0;
    for (const row of rows) {
      if (await this.resumeCancellation(row)) {
        cancelled += 1;
      }
    }

    return {
      scanned: rows.length,
      cancelled,
    };
  }
}
