import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ManagerAlertSourceScanService } from './manager-alert-source-scan.service';
import { ManagerAlertBusinessScanService } from './manager-alert-business-scan.service';
import { managerAlertLiveAccess } from './manager-alert-authorization';
import { managerAlertQuietUntil } from './manager-alert-quiet-hours';
import {
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
  ManagerAlertChannel,
  ManagerAlertDeliveryStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CommunicationDispatchFailure,
  ExternalCommunicationAdapterRegistry,
} from '../communication/communication-dispatch-adapter';
import { IntegrationRuntimeEnvironmentService } from '../integrations/runtime-environment.service';
import { IntegrationSecretResolverService } from '../integrations/secrets/integration-secret-resolver.service';
import {
  TransactionalEmailDispatchFailure,
  TransactionalEmailProviderAdapterRegistry,
} from '../transactional-email/transactional-email-provider-adapter';

const INTERVAL_MS = 5_000;
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 5;

function hasCapability(raw: unknown, capability: string) {
  return Array.isArray(raw) && raw.some((item) => typeof item === 'string' && item.toLowerCase() === capability);
}

function retryAt(attempt: number) {
  const schedule = [30_000, 120_000, 600_000, 1_800_000, 7_200_000];
  return new Date(Date.now() + schedule[Math.min(Math.max(attempt - 1, 0), schedule.length - 1)]);
}

function errorCode(error: unknown) {
  if (error instanceof CommunicationDispatchFailure || error instanceof TransactionalEmailDispatchFailure) return error.code.slice(0, 96);
  return 'ALERT_DELIVERY_UNAVAILABLE';
}

@Injectable()
export class ManagerAlertDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ManagerAlertDispatchService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly secrets: IntegrationSecretResolverService,
    private readonly communicationAdapters: ExternalCommunicationAdapterRegistry,
    private readonly emailAdapters: TransactionalEmailProviderAdapterRegistry,
    private readonly audit: AuditService,
    private readonly sourceScan: ManagerAlertSourceScanService,
    private readonly businessScan: ManagerAlertBusinessScanService,
  ) {}

  onModuleInit() {
    if (!this.enabled('MANAGER_ALERT_DISPATCH_ENABLED') && !this.enabled('MANAGER_ALERT_SCAN_ENABLED')) return;
    this.timer = setInterval(() => void this.runCycle().catch(() => this.logger.error('MANAGER_ALERT_CYCLE_FAILED')), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async dispatchDue(limit = 20) {
    const now = new Date();
    // Recover interrupted workers using the same persisted provider idempotency key.
    for (const exhausted of [false, true]) {
      await this.prisma.managerAlertDelivery.updateMany({
        where: { status: ManagerAlertDeliveryStatus.SENDING, attemptCount: exhausted ? { gte: MAX_ATTEMPTS } : { lt: MAX_ATTEMPTS }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        data: { status: exhausted ? ManagerAlertDeliveryStatus.DEAD_LETTER : ManagerAlertDeliveryStatus.FAILED, leaseOwner: null, leaseUntil: null, nextAttemptAt: exhausted ? null : now, lastErrorCode: 'DELIVERY_LEASE_EXPIRED' },
      });
    }
    const rows = await this.prisma.managerAlertDelivery.findMany({
      where: {
        status: { in: [ManagerAlertDeliveryStatus.PENDING, ManagerAlertDeliveryStatus.FAILED, ManagerAlertDeliveryStatus.DEFERRED] },
        attemptCount: { lt: MAX_ATTEMPTS },
        AND: [
          { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true },
    });
    const results: Array<{ id: string; dispatched: boolean; reason?: string }> = [];
    for (const row of rows) results.push(await this.dispatchOne(row.id));
    return results;
  }

  private async dispatchOne(id: string) {
    const leaseOwner = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.managerAlertDelivery.updateMany({
      where: {
        id,
        status: { in: [ManagerAlertDeliveryStatus.PENDING, ManagerAlertDeliveryStatus.FAILED, ManagerAlertDeliveryStatus.DEFERRED] },
        attemptCount: { lt: MAX_ATTEMPTS },
        AND: [
          { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        ],
      },
      data: {
        status: ManagerAlertDeliveryStatus.SENDING,
        leaseOwner,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
        attemptCount: { increment: 1 },
        lastErrorCode: null,
      },
    });
    if (claimed.count !== 1) return { id, dispatched: false, reason: 'NOT_DUE_OR_LOCKED' };

    const row = await this.prisma.managerAlertDelivery.findUnique({
      where: { id },
      include: {
        alert: true,
        recipient: { include: { user: true } },
      },
    });
    if (!row || row.leaseOwner !== leaseOwner) return { id, dispatched: false, reason: 'LEASE_LOST' };

    try {
      const live = await this.prisma.managerAlert.findFirst({ where: { id: row.alertId, gymId: row.alert.gymId, AND: [managerAlertLiveAccess(row.alert.gymId, row.recipient.userId)] }, select: { id: true } });
      const [policy, preference] = await Promise.all([
        this.prisma.managerAlertPolicy.findUnique({ where: { gymId_category: { gymId: row.alert.gymId, category: row.alert.category } } }),
        this.prisma.managerAlertPreference.findUnique({ where: { gymId_userId_category: { gymId: row.alert.gymId, userId: row.recipient.userId, category: row.alert.category } } }),
      ]);
      const allowed = row.channel === ManagerAlertChannel.EMAIL ? policy?.emailAllowed && preference?.emailEnabled
        : row.channel === ManagerAlertChannel.WHATSAPP ? policy?.whatsappAllowed && preference?.whatsappEnabled
          : policy?.pushAllowed && preference?.pushEnabled;
      const rank = { INFO: 1, WARNING: 2, CRITICAL: 3 };
      const filtered = policy && preference && rank[row.alert.severity] < Math.max(rank[policy.minimumSeverity], rank[preference.minimumSeverity]);
      const skip = !live || row.recipient.alertId !== row.alertId || ['RESOLVED', 'DISMISSED'].includes(row.alert.status) || !allowed || filtered;
      const quietUntil = !skip && preference ? managerAlertQuietUntil(now, preference) : null;
      if (skip || quietUntil) {
        const reason = skip ? 'DELIVERY_AUTHORITY_OR_PREFERENCE_REVOKED' : 'QUIET_HOURS';
        const changed = await this.prisma.managerAlertDelivery.updateMany({
          where: { id, leaseOwner, status: ManagerAlertDeliveryStatus.SENDING },
          data: { status: skip ? ManagerAlertDeliveryStatus.SKIPPED : ManagerAlertDeliveryStatus.DEFERRED, leaseOwner: null, leaseUntil: null, nextAttemptAt: quietUntil, attemptCount: { decrement: 1 }, lastErrorCode: reason },
        });
        if (changed.count === 1) await this.audit.record({ gymId: row.alert.gymId, userId: row.recipient.userId, action: skip ? 'MANAGER_ALERT_DELIVERY_SKIPPED' : 'MANAGER_ALERT_DELIVERY_DEFERRED', entity: 'ManagerAlertDelivery', entityId: id, next: { reason, channel: row.channel } });
        return { id, dispatched: false, reason };
      }
      const result = row.channel === ManagerAlertChannel.WHATSAPP
        ? await this.sendWhatsapp(row)
        : row.channel === ManagerAlertChannel.EMAIL
          ? await this.sendEmail(row)
          : await this.sendPush();
      const updated = await this.prisma.managerAlertDelivery.updateMany({
        where: { id, leaseOwner, status: ManagerAlertDeliveryStatus.SENDING },
        data: {
          status: ManagerAlertDeliveryStatus.SENT,
          sentAt: new Date(),
          providerCode: result.providerCode,
          providerMessageRef: result.providerMessageRef,
          leaseOwner: null,
          leaseUntil: null,
          nextAttemptAt: null,
        },
      });
      if (updated.count !== 1) return { id, dispatched: false, reason: 'LEASE_LOST' };
      await this.audit.record({ gymId: row.alert.gymId, userId: row.recipient.userId, action: 'MANAGER_ALERT_DELIVERY_SENT', entity: 'ManagerAlertDelivery', entityId: id, next: { channel: row.channel, providerCode: result.providerCode } });
      return { id, dispatched: true };
    } catch (error) {
      const terminal = row.attemptCount >= MAX_ATTEMPTS;
      const failed = await this.prisma.managerAlertDelivery.updateMany({
        where: { id, leaseOwner, status: ManagerAlertDeliveryStatus.SENDING },
        data: {
          status: terminal ? ManagerAlertDeliveryStatus.DEAD_LETTER : ManagerAlertDeliveryStatus.FAILED,
          lastErrorCode: errorCode(error),
          nextAttemptAt: terminal ? null : retryAt(row.attemptCount),
          leaseOwner: null,
          leaseUntil: null,
        },
      });
      if (failed.count !== 1) return { id, dispatched: false, reason: 'LEASE_LOST_OR_COMPLETED' };
      await this.audit.record({ gymId: row.alert.gymId, userId: row.recipient.userId, action: terminal ? 'MANAGER_ALERT_DELIVERY_DEAD_LETTER' : 'MANAGER_ALERT_DELIVERY_FAILED', entity: 'ManagerAlertDelivery', entityId: id, next: { channel: row.channel, errorCode: errorCode(error), attemptCount: row.attemptCount } });
      return { id, dispatched: false, reason: errorCode(error) };
    }
  }

  private async sendWhatsapp(row: any) {
    let connection = await this.optionalConnection(row.alert.gymId, IntegrationScope.TENANT, ['meta.whatsapp']);
    let publicConfiguration: unknown;
    let credential;
    if (connection) {
      credential = await this.secrets.resolveForExternalBoundary(connection.id, { scope: 'TENANT', gymId: row.alert.gymId });
      publicConfiguration = connection.publicConfiguration;
    } else {
      const binding = await this.prisma.evolutionTenantInstance.findUnique({ where: { gymId: row.alert.gymId } });
      if (!binding) throw new CommunicationDispatchFailure('EVOLUTION_INSTANCE_MISSING');
      connection = await this.connection(null, IntegrationScope.GLOBAL, ['evolution.whatsapp'], binding.globalConnectionId);
      credential = await this.secrets.resolveForExternalBoundary(connection.id, { scope: 'GLOBAL' });
      const raw = connection.publicConfiguration && typeof connection.publicConfiguration === 'object' && !Array.isArray(connection.publicConfiguration)
        ? connection.publicConfiguration as Record<string, unknown>
        : {};
      publicConfiguration = { ...raw, instanceName: binding.instanceName };
    }
    const adapter = this.communicationAdapters.require(connection.providerCode, 'WHATSAPP');
    const result = await adapter.dispatch({
      dispatchKey: row.idempotencyKey,
      recipient: row.recipient.user.phone ?? '',
      title: row.alert.title,
      body: `${row.alert.title}\n\n${row.alert.message}`,
      publicConfiguration,
      credential,
    });
    return { ...result, providerCode: connection.providerCode };
  }

  private async sendEmail(row: any) {
    const connection = await this.connection(null, IntegrationScope.GLOBAL, ['email.transactional']);
    const credential = await this.secrets.resolveForExternalBoundary(connection.id, { scope: 'GLOBAL' });
    const adapter = this.emailAdapters.require(connection.providerCode);
    const result = await adapter.dispatch({
      dispatchKey: row.idempotencyKey,
      recipient: row.recipient.user.email,
      subject: row.alert.title,
      textBody: `${row.alert.title}\n\n${row.alert.message}`,
      htmlBody: `<h1>${this.escape(row.alert.title)}</h1><p>${this.escape(row.alert.message)}</p>`,
      publicConfiguration: connection.publicConfiguration,
      credential,
    });
    return { ...result, providerCode: connection.providerCode };
  }

  private async sendPush(): Promise<never> {
    throw new CommunicationDispatchFailure('PUSH_ADAPTER_NOT_IMPLEMENTED');
  }

  private async optionalConnection(gymId: string | null, scope: IntegrationScope, capabilities: string[]) {
    const candidates = await this.prisma.integrationConnection.findMany({
      where: {
        gymId,
        scope,
        environment: this.runtime.current() as IntegrationEnvironment,
        status: IntegrationConnectionStatus.ACTIVE,
        secretReference: { not: null },
        secretVersion: { not: null },
        secretRevokedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });
    const capable = candidates.filter((item) => capabilities.some((capability) => hasCapability(item.capabilities, capability)));
    if (capable.length > 1) throw new CommunicationDispatchFailure('PROVIDER_CONNECTION_AMBIGUOUS');
    return capable[0] ?? null;
  }

  private async connection(gymId: string | null, scope: IntegrationScope, capabilities: string[], connectionId?: string) {
    const connection = await this.optionalConnection(gymId, scope, capabilities);
    if (!connection || (connectionId && connection.id !== connectionId)) {
      throw new CommunicationDispatchFailure('PROVIDER_CONNECTION_MISSING');
    }
    return connection;
  }

  private escape(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
  }

  private async runCycle() {
    if (this.running) return;
    this.running = true;
    try {
      if (this.enabled('MANAGER_ALERT_SCAN_ENABLED')) {
        const results = await Promise.allSettled([this.sourceScan.scanDue(), this.businessScan.scanDue()]);
        if (results.some((result) => result.status === 'rejected')) this.logger.error('MANAGER_ALERT_SOURCE_SCAN_FAILED');
      }
      if (this.enabled('MANAGER_ALERT_DISPATCH_ENABLED')) await this.dispatchDue();
    } finally { this.running = false; }
  }

  private enabled(key: string) {
    return this.config.get<string>(key)?.trim().toLowerCase() === 'true';
  }
}
