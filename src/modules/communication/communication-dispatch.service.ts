import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
  MessageChannel,
  MessageStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';
import { IntegrationSecretResolverService } from '../integrations/secrets/integration-secret-resolver.service';
import { parseOAuthTokenBundle } from '../integrations/integration-oauth-token-bundle';
import {
  CommunicationDispatchFailure,
  ExternalCommunicationAdapterRegistry,
} from './communication-dispatch-adapter';

const DISPATCH_INTERVAL_MS = 5_000;
const DISPATCH_LEASE_MS = 2 * 60_000;
const DISPATCH_BATCH_SIZE = 20;
const MAX_DISPATCH_ATTEMPTS = 5;

function retryBackoffMs(attempt: number): number {
  const schedule = [
    30_000,
    2 * 60_000,
    10 * 60_000,
    30 * 60_000,
    2 * 60 * 60_000,
  ];
  return schedule[
    Math.min(Math.max(attempt - 1, 0), schedule.length - 1)
  ];
}

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

function failureCode(error: unknown): string {
  return error instanceof CommunicationDispatchFailure
    ? error.code
    : 'DISPATCH_INTERNAL_FAILURE';
}

@Injectable()
export class CommunicationDispatchService
  implements OnModuleInit, OnModuleDestroy
{
  private timer: NodeJS.Timeout | null = null;
  private cycleRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: ExternalCommunicationAdapterRegistry,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly secrets: IntegrationSecretResolverService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.runCycle().catch(() => undefined);
    }, DISPATCH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private requiredProviders(channel: MessageChannel): Array<{
    providerCode: string;
    capability: string;
    authModel: string;
  }> {
    if (channel === MessageChannel.WHATSAPP) {
      return [
        { providerCode: 'meta', capability: 'meta.whatsapp', authModel: 'OAUTH2' },
        { providerCode: 'evolution', capability: 'evolution.whatsapp', authModel: 'API_KEY' },
      ];
    }
    throw new CommunicationDispatchFailure(
      'CHANNEL_NOT_EXTERNAL_I6',
    );
  }

  private async resolveTenantConnection(
    gymId: string,
    channel: MessageChannel,
  ) {
    const required = this.requiredProviders(channel);
    const environment =
      this.runtime.current() as IntegrationEnvironment;
    const candidates = await this.prisma.integrationConnection.findMany({
      where: {
        scope: IntegrationScope.TENANT,
        gymId,
        providerCode: { in: required.map((item) => item.providerCode) },
        environment,
        authModel: { in: required.map((item) => item.authModel) },
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

    const capable = candidates.filter((candidate) => {
      const rule = required.find(
        (item) =>
          item.providerCode === candidate.providerCode &&
          item.authModel === candidate.authModel,
      );
      return Boolean(rule && hasCapability(candidate.capabilities, rule.capability));
    });
    if (capable.length !== 1) {
      throw new CommunicationDispatchFailure(
        capable.length === 0
          ? 'PROVIDER_CONNECTION_MISSING'
          : 'PROVIDER_CONNECTION_AMBIGUOUS',
      );
    }
    return capable[0];
  }

  async dispatchDue(limit = DISPATCH_BATCH_SIZE) {
    const now = new Date();
    const rows = await this.prisma.communicationMessage.findMany({
      where: {
        channel: MessageChannel.WHATSAPP,
        status: {
          in: [MessageStatus.QUEUED, MessageStatus.FAILED],
        },
        attemptCount: { lt: MAX_DISPATCH_ATTEMPTS },
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
              { dispatchLeaseUntil: { lt: now } },
            ],
          },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true },
    });

    const results: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      results.push(await this.dispatchOne(row.id));
    }
    return results;
  }

  async dispatchOne(messageId: string) {
    const now = new Date();
    const leaseOwner = randomUUID();
    const leaseUntil = new Date(now.getTime() + DISPATCH_LEASE_MS);

    const acquired = await this.prisma.communicationMessage.updateMany({
      where: {
        id: messageId,
        channel: MessageChannel.WHATSAPP,
        status: {
          in: [MessageStatus.QUEUED, MessageStatus.FAILED],
        },
        attemptCount: { lt: MAX_DISPATCH_ATTEMPTS },
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
              { dispatchLeaseUntil: { lt: now } },
            ],
          },
        ],
      },
      data: {
        status: MessageStatus.SENDING,
        dispatchLeaseOwner: leaseOwner,
        dispatchLeaseUntil: leaseUntil,
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
        lastErrorCode: null,
        errorMessage: null,
      },
    });

    if (acquired.count !== 1) {
      return {
        messageId,
        dispatched: false,
        reason: 'NOT_DUE_OR_LOCKED',
      };
    }

    const message = await this.prisma.communicationMessage.findUnique({
      where: { id: messageId },
      include: {
        student: {
          include: {
            user: true,
            communicationPreference: true,
          },
        },
      },
    });

    if (
      !message ||
      message.dispatchLeaseOwner !== leaseOwner ||
      message.status !== MessageStatus.SENDING
    ) {
      await this.failDispatch(
        messageId,
        leaseOwner,
        message?.attemptCount ?? 1,
        'MESSAGE_STATE_CHANGED',
        message?.gymId ?? null,
      );
      return {
        messageId,
        dispatched: false,
        reason: 'MESSAGE_STATE_CHANGED',
      };
    }

    try {
      // Status may change between queue admission and provider dispatch.
      // Revalidate the canonical enrollment at the external boundary.
      if (message.student.status !== 'ACTIVE') {
        throw new CommunicationDispatchFailure('STUDENT_INACTIVE');
      }
      if (!message.student.consentComm) {
        throw new CommunicationDispatchFailure(
          'COMMUNICATION_CONSENT_REQUIRED',
        );
      }
      if (
        message.student.communicationPreference?.whatsappEnabled !== true
      ) {
        throw new CommunicationDispatchFailure(
          'WHATSAPP_PREFERENCE_DISABLED',
        );
      }
      const phone = message.student.user?.phone?.trim();
      if (!phone) {
        throw new CommunicationDispatchFailure(
          'RECIPIENT_PHONE_MISSING',
        );
      }

      const connection = await this.resolveTenantConnection(
        message.gymId,
        message.channel,
      );
      const secret = await this.secrets.resolveForExternalBoundary(
        connection.id,
        { scope: 'TENANT', gymId: message.gymId },
      );
      const credential = connection.authModel === 'OAUTH2'
        ? parseOAuthTokenBundle(secret.reveal(), connection.providerCode)
        : null;

      if (credential?.accessExpiresAt && credential.accessExpiresAt <= new Date()) {
        throw new CommunicationDispatchFailure('OAUTH_ACCESS_TOKEN_EXPIRED');
      }

      const adapter = this.adapters.require(
        connection.providerCode,
        message.channel,
      );
      const result = await adapter.dispatch({
        dispatchKey: message.dispatchKey,
        recipient: phone,
        title: message.title,
        body: message.body,
        publicConfiguration: connection.publicConfiguration,
        credential: credential?.accessToken ?? secret,
      });

      const sentAt = new Date();
      const finalized = await this.prisma.communicationMessage.updateMany({
        where: {
          id: message.id,
          status: MessageStatus.SENDING,
          dispatchLeaseOwner: leaseOwner,
        },
        data: {
          status: MessageStatus.SENT,
          providerCode: connection.providerCode,
          providerConnectionId: connection.id,
          providerMessageRef: result.providerMessageRef,
          sentAt,
          nextAttemptAt: null,
          dispatchLeaseOwner: null,
          dispatchLeaseUntil: null,
          lastErrorCode: null,
          errorMessage: null,
        },
      });
      if (finalized.count !== 1) {
        throw new CommunicationDispatchFailure(
          'MESSAGE_FINALIZE_CONFLICT',
        );
      }

      await this.audit.record({
        gymId: message.gymId,
        userId: null,
        action: 'COMMUNICATION_EXTERNAL_SENT',
        entity: 'CommunicationMessage',
        entityId: message.id,
        next: {
          channel: message.channel,
          providerCode: connection.providerCode,
          providerConnectionId: connection.id,
          providerMessageRef: result.providerMessageRef,
          dispatchKey: message.dispatchKey,
          attemptCount: message.attemptCount,
          sentAt,
        },
      });

      return {
        messageId: message.id,
        dispatched: true,
        status: MessageStatus.SENT,
        providerCode: connection.providerCode,
        providerMessageRef: result.providerMessageRef,
      };
    } catch (error) {
      const code = failureCode(error);
      await this.failDispatch(
        message.id,
        leaseOwner,
        message.attemptCount,
        code,
        message.gymId,
      );
      return {
        messageId: message.id,
        dispatched: false,
        reason: code,
      };
    }
  }

  private async failDispatch(
    messageId: string,
    leaseOwner: string,
    attemptCount: number,
    code: string,
    gymId: string | null,
  ) {
    const exhausted = attemptCount >= MAX_DISPATCH_ATTEMPTS;
    const nextAttemptAt = exhausted
      ? null
      : new Date(Date.now() + retryBackoffMs(attemptCount));
    const changed = await this.prisma.communicationMessage.updateMany({
      where: {
        id: messageId,
        status: MessageStatus.SENDING,
        dispatchLeaseOwner: leaseOwner,
      },
      data: {
        status: MessageStatus.FAILED,
        nextAttemptAt,
        dispatchLeaseOwner: null,
        dispatchLeaseUntil: null,
        lastErrorCode: code.slice(0, 128),
        errorMessage: code.slice(0, 128),
      },
    });

    if (changed.count === 1) {
      await this.audit
        .record({
          gymId,
          userId: null,
          action: 'COMMUNICATION_EXTERNAL_FAILED',
          entity: 'CommunicationMessage',
          entityId: messageId,
          next: {
            failureCode: code.slice(0, 128),
            attemptCount,
            exhausted,
            nextAttemptAt,
          },
        })
        .catch(() => undefined);
    }
  }

  async runCycle() {
    if (this.cycleRunning) return { skipped: true };
    this.cycleRunning = true;
    try {
      const results = await this.dispatchDue();
      return { skipped: false, results };
    } finally {
      this.cycleRunning = false;
    }
  }
}
