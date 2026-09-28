import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  FiscalHandoffStatus,
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';
import { IntegrationSecretResolverService } from '../integrations/secrets/integration-secret-resolver.service';
import {
  FM_FISCAL_CAPABILITY,
  FM_FISCAL_PROVIDER_CODE,
  FiscalBridgeHttpTransport,
  FiscalBridgeRequestContext,
  FiscalBridgeTransportError,
  fiscalBridgeEnvironment,
  parseFiscalBridgePublicConfiguration,
} from './fiscal-bridge.contract';
import { FiscalScopeBindingService } from './fiscal-scope-binding.service';
import {
  assertCanonicalFiscalHandoff,
  buildFiscalIssuanceRequest,
} from './fiscal-bridge-payload';

const DISPATCH_BATCH_SIZE = 20;
const DISPATCH_LEASE_MS = 2 * 60_000;
const CAPABILITY_RETRY_MS = 15 * 60_000;

function hasCapability(raw: unknown, required: string): boolean {
  return (
    Array.isArray(raw) &&
    raw.some(
      (value) =>
        typeof value === 'string' &&
        value.trim().toLowerCase() === required,
    )
  );
}

function errorCode(error: unknown): string {
  if (error instanceof FiscalBridgeTransportError) {
    return error.code.slice(0, 128);
  }
  if (
    error instanceof ServiceUnavailableException &&
    typeof error.message === 'string'
  ) {
    return 'FISCAL_CONFIGURATION_UNAVAILABLE';
  }
  return 'FISCAL_DISPATCH_FAILED';
}

@Injectable()
export class FiscalBridgeDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly secrets: IntegrationSecretResolverService,
    private readonly bindings: FiscalScopeBindingService,
    private readonly http: FiscalBridgeHttpTransport,
    private readonly audit: AuditService,
  ) {}

  async resolveBridgeContext(
    gymId: string,
  ): Promise<{
    connectionId: string;
    context: FiscalBridgeRequestContext;
  }> {
    const environment =
      this.runtime.current() as IntegrationEnvironment;
    fiscalBridgeEnvironment(environment);

    const candidates =
      await this.prisma.integrationConnection.findMany({
        where: {
          scope: IntegrationScope.GLOBAL,
          gymId: null,
          providerCode: FM_FISCAL_PROVIDER_CODE,
          environment,
          status: IntegrationConnectionStatus.ACTIVE,
          secretReference: { not: null },
          secretVersion: { not: null },
          secretRevokedAt: null,
          OR: [
            { secretExpiresAt: null },
            { secretExpiresAt: { gt: new Date() } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
      });

    const capable = candidates.filter((connection) =>
      hasCapability(
        connection.capabilities,
        FM_FISCAL_CAPABILITY,
      ),
    );
    if (capable.length !== 1) {
      throw new ServiceUnavailableException(
        capable.length === 0
          ? 'FM Fiscal Bridge GLOBAL nao configurado/homologado'
          : 'FM Fiscal Bridge GLOBAL ambiguo',
      );
    }

    const connection = capable[0];
    const configuration =
      parseFiscalBridgePublicConfiguration(
        connection.publicConfiguration,
      );
    const credential =
      await this.secrets.resolveForExternalBoundary(
        connection.id,
        { scope: 'GLOBAL' },
      );
    const binding = await this.bindings.resolve(gymId);

    return {
      connectionId: connection.id,
      context: {
        environment,
        scope: {
          tenantId: binding.externalTenantId,
          unitId: binding.externalUnitId,
        },
        configuration,
        credential,
      },
    };
  }

  private readinessAllowsIssue(
    environment: IntegrationEnvironment,
    readiness: string,
  ): boolean {
    if (environment === IntegrationEnvironment.PROD) {
      return readiness === 'PRODUCTION_APPROVED';
    }
    if (environment === IntegrationEnvironment.HOMOLOG) {
      return (
        readiness === 'HOMOLOGATION_READY' ||
        readiness === 'PRODUCTION_APPROVED'
      );
    }
    return false;
  }

  private async scheduleCapabilityRetry(
    row: any,
    leaseOwner: string,
    code: string,
  ) {
    await this.prisma.fiscalHandoff.updateMany({
      where: {
        id: row.id,
        dispatchLeaseOwner: leaseOwner,
      },
      data: {
        status: FiscalHandoffStatus.PENDING_CAPABILITY,
        nextAttemptAt: new Date(
          Date.now() + CAPABILITY_RETRY_MS,
        ),
        dispatchLeaseOwner: null,
        dispatchLeaseUntil: null,
        lastErrorCode: code.slice(0, 128),
      },
    });
  }

  private async markUnknownOutcome(
    row: any,
    leaseOwner: string,
    connectionId: string | null,
    code: string,
  ) {
    await this.prisma.fiscalHandoff.updateMany({
      where: {
        id: row.id,
        dispatchLeaseOwner: leaseOwner,
      },
      data: {
        status:
          FiscalHandoffStatus.RECONCILIATION_PENDING,
        bridgeConnectionId: connectionId,
        nextAttemptAt: null,
        dispatchLeaseOwner: null,
        dispatchLeaseUntil: null,
        lastErrorCode: code.slice(0, 128),
      },
    });
  }

  private async processClaimed(
    row: any,
    leaseOwner: string,
  ) {
    let connectionId: string | null = null;
    let issuanceStarted = false;

    try {
      assertCanonicalFiscalHandoff(row);
      const resolved = await this.resolveBridgeContext(row.gymId);
      connectionId = resolved.connectionId;
      const correlationId = randomUUID();

      const capabilityPayload = await this.http.post(
        '/v1/capabilities/query',
        { document_kind: 'nfse' },
        resolved.context,
        correlationId,
      );
      const capability =
        this.http.parseCapability(capabilityPayload);

      const required = new Set(
        capability.capabilities.map((item) =>
          item.toLowerCase(),
        ),
      );
      const ready =
        required.has('nfse') &&
        required.has('issue') &&
        this.readinessAllowsIssue(
          resolved.context.environment,
          capability.readiness,
        );

      if (!ready) {
        await this.scheduleCapabilityRetry(
          row,
          leaseOwner,
          'FISCAL_CAPABILITY_NOT_READY',
        );
        return false;
      }

      const readyUpdate =
        await this.prisma.fiscalHandoff.updateMany({
          where: {
            id: row.id,
            dispatchLeaseOwner: leaseOwner,
            status: {
              in: [
                FiscalHandoffStatus.PENDING_CAPABILITY,
                FiscalHandoffStatus.READY_TO_ISSUE,
              ],
            },
          },
          data: {
            status: FiscalHandoffStatus.READY_TO_ISSUE,
            capabilityVersion:
              capability.capabilityVersion,
            bridgeConnectionId: connectionId,
            lastErrorCode: null,
          },
        });
      if (readyUpdate.count !== 1) return false;

      const issuanceRequest = buildFiscalIssuanceRequest(row);
      issuanceStarted = true;
      const issuancePayload = await this.http.post(
        '/v1/issuances',
        issuanceRequest,
        resolved.context,
        correlationId,
        row.idempotencyKey,
      );
      const issuance =
        this.http.parseIssuance(issuancePayload);

      const nextStatus =
        issuance.status === 'authorized'
          ? FiscalHandoffStatus.AUTHORIZED
          : issuance.status === 'rejected'
            ? FiscalHandoffStatus.REJECTED
            : FiscalHandoffStatus.SUBMITTED;

      const now = new Date();
      const completed =
        await this.prisma.fiscalHandoff.updateMany({
          where: {
            id: row.id,
            dispatchLeaseOwner: leaseOwner,
          },
          data: {
            status: nextStatus,
            providerRequestId: issuance.requestId,
            providerDocumentId: issuance.documentId,
            providerAccessKey: issuance.accessKey,
            providerProtocolReference:
              issuance.protocolReference,
            authorizedAt:
              nextStatus === FiscalHandoffStatus.AUTHORIZED
                ? now
                : null,
            nextAttemptAt: null,
            dispatchLeaseOwner: null,
            dispatchLeaseUntil: null,
            lastErrorCode: null,
          },
        });
      if (completed.count !== 1) return false;

      await this.audit.record({
        gymId: row.gymId,
        action: 'FISCAL_BRIDGE_ISSUANCE_RESULT',
        entity: 'FiscalHandoff',
        entityId: row.id,
        next: {
          bridgeConnectionId: connectionId,
          capabilityVersion:
            capability.capabilityVersion,
          status: nextStatus,
          requestId: issuance.requestId,
          documentId: issuance.documentId,
          replay: issuance.replay,
        },
      });

      return true;
    } catch (error) {
      const code = errorCode(error);
      if (issuanceStarted) {
        await this.markUnknownOutcome(
          row,
          leaseOwner,
          connectionId,
          code,
        );
      } else {
        await this.scheduleCapabilityRetry(
          row,
          leaseOwner,
          code,
        );
      }
      return false;
    }
  }

  async dispatchDue(limit = DISPATCH_BATCH_SIZE) {
    const now = new Date();
    const rows =
      await this.prisma.fiscalHandoff.findMany({
        where: {
          status: {
            in: [
              FiscalHandoffStatus.PENDING_CAPABILITY,
              FiscalHandoffStatus.READY_TO_ISSUE,
            ],
          },
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

    let completed = 0;
    for (const row of rows) {
      const leaseOwner = randomUUID();
      const claimed =
        await this.prisma.fiscalHandoff.updateMany({
          where: {
            id: row.id,
            status: {
              in: [
                FiscalHandoffStatus.PENDING_CAPABILITY,
                FiscalHandoffStatus.READY_TO_ISSUE,
              ],
            },
            OR: [
              { dispatchLeaseUntil: null },
              { dispatchLeaseUntil: { lte: new Date() } },
            ],
          },
          data: {
            dispatchLeaseOwner: leaseOwner,
            dispatchLeaseUntil: new Date(
              Date.now() + DISPATCH_LEASE_MS,
            ),
            lastAttemptAt: new Date(),
            attemptCount: { increment: 1 },
          },
        });
      if (claimed.count !== 1) continue;
      if (await this.processClaimed(row, leaseOwner)) {
        completed += 1;
      }
    }

    return {
      scanned: rows.length,
      completed,
    };
  }
}
