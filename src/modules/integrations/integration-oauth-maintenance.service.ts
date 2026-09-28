import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationScope,
  IntegrationSecretCleanupStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { newIntegrationSecretReference } from './contracts/integration-contract';
import {
  IntegrationOAuthProviderAdapterRegistry,
  parseOAuthAppPublicConfiguration,
} from './integration-oauth-provider-adapters';
import {
  parseOAuthTokenBundle,
  serializeOAuthTokenBundle,
} from './integration-oauth-token-bundle';
import {
  INTEGRATION_SECRET_VAULT,
  IntegrationSecretValue,
  IntegrationSecretVaultPort,
} from './secrets/integration-secret-vault.port';

const REFRESH_INTERVAL_MS = 60_000;
const REFRESH_AHEAD_MS = 5 * 60_000;
const REFRESH_LEASE_MS = 2 * 60_000;
const REFRESH_BATCH_SIZE = 20;
const OAUTH_PROVIDER_REVOKE_PENDING = 'OAUTH_PROVIDER_REVOKE_PENDING';
const OAUTH_LOCAL_REVOKE_PENDING = 'OAUTH_LOCAL_REVOKE_PENDING';

function refreshBackoffMs(failureCount: number): number {
  const schedule = [
    60_000,
    5 * 60_000,
    15 * 60_000,
    60 * 60_000,
    6 * 60 * 60_000,
  ];
  return schedule[Math.min(Math.max(failureCount - 1, 0), schedule.length - 1)];
}

function scopes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].sort();
}

@Injectable()
export class IntegrationOAuthMaintenanceService
  implements OnModuleInit, OnModuleDestroy
{
  private timer: NodeJS.Timeout | null = null;
  private cycleRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: IntegrationOAuthProviderAdapterRegistry,
    private readonly audit: AuditService,
    @Inject(INTEGRATION_SECRET_VAULT)
    private readonly vault: IntegrationSecretVaultPort,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.runCycle().catch(() => undefined);
    }, REFRESH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async scheduleCleanup(
    connectionId: string | null,
    reference: string,
    reason: string,
  ) {
    const now = new Date();
    await this.prisma.integrationSecretCleanupTask.upsert({
      where: { secretReference: reference },
      create: {
        integrationConnectionId: connectionId,
        secretReference: reference,
        reason,
        status: IntegrationSecretCleanupStatus.PENDING,
        attempts: 1,
        lastAttemptAt: now,
      },
      update: {
        integrationConnectionId: connectionId,
        reason,
        status: IntegrationSecretCleanupStatus.PENDING,
        attempts: { increment: 1 },
        lastAttemptAt: now,
        completedAt: null,
      },
    });
  }

  private async loadBoundApp(connection: any) {
    if (!connection.oauthAppConnectionId) {
      throw new ServiceUnavailableException(
        'Conexao OAuth sem binding do App global',
      );
    }
    const app = await this.prisma.integrationConnection.findUnique({
      where: { id: connection.oauthAppConnectionId },
    });
    if (
      !app ||
      app.scope !== IntegrationScope.GLOBAL ||
      app.gymId !== null ||
      app.providerCode !== connection.providerCode ||
      app.environment !== connection.environment ||
      app.authModel !== 'OAUTH2' ||
      app.status !== IntegrationConnectionStatus.ACTIVE ||
      !app.secretReference ||
      !app.secretVersion ||
      app.secretRevokedAt
    ) {
      throw new ServiceUnavailableException(
        'OAuth App global vinculado indisponivel',
      );
    }
    return app;
  }

  async refreshDue(limit = REFRESH_BATCH_SIZE) {
    const now = new Date();
    const threshold = new Date(now.getTime() + REFRESH_AHEAD_MS);
    const rows = await this.prisma.integrationConnection.findMany({
      where: {
        scope: IntegrationScope.TENANT,
        authModel: 'OAUTH2',
        oauthRefreshCapable: true,
        secretRevokedAt: null,
        status: {
          in: [
            IntegrationConnectionStatus.ACTIVE,
            IntegrationConnectionStatus.DEGRADED,
          ],
        },
        AND: [
          {
            OR: [
              { oauthAccessExpiresAt: null },
              { oauthAccessExpiresAt: { lte: threshold } },
            ],
          },
          {
            OR: [
              { oauthRefreshRetryAt: null },
              { oauthRefreshRetryAt: { lte: now } },
            ],
          },
        ],
      },
      orderBy: [{ oauthAccessExpiresAt: 'asc' }, { updatedAt: 'asc' }],
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true },
    });

    const results = [];
    for (const row of rows) {
      results.push(await this.refreshOne(row.id));
    }
    return results;
  }

  async refreshOne(connectionId: string) {
    const now = new Date();
    const threshold = new Date(now.getTime() + REFRESH_AHEAD_MS);
    const leaseOwner = randomUUID();
    const leaseUntil = new Date(now.getTime() + REFRESH_LEASE_MS);

    const acquired = await this.prisma.integrationConnection.updateMany({
      where: {
        id: connectionId,
        scope: IntegrationScope.TENANT,
        authModel: 'OAUTH2',
        oauthRefreshCapable: true,
        secretRevokedAt: null,
        status: {
          in: [
            IntegrationConnectionStatus.ACTIVE,
            IntegrationConnectionStatus.DEGRADED,
          ],
        },
        AND: [
          {
            OR: [
              { oauthAccessExpiresAt: null },
              { oauthAccessExpiresAt: { lte: threshold } },
            ],
          },
          {
            OR: [
              { oauthRefreshRetryAt: null },
              { oauthRefreshRetryAt: { lte: now } },
            ],
          },
          {
            OR: [
              { oauthRefreshLeaseUntil: null },
              { oauthRefreshLeaseUntil: { lt: now } },
            ],
          },
        ],
      },
      data: {
        oauthRefreshLeaseOwner: leaseOwner,
        oauthRefreshLeaseUntil: leaseUntil,
      },
    });

    if (acquired.count !== 1) {
      return { connectionId, refreshed: false, reason: 'NOT_DUE_OR_LOCKED' };
    }

    const connection = await this.prisma.integrationConnection.findUnique({
      where: { id: connectionId },
    });
    if (
      !connection ||
      connection.oauthRefreshLeaseOwner !== leaseOwner ||
      !connection.secretReference ||
      !connection.secretVersion
    ) {
      await this.releaseFailedLease(
        connectionId,
        leaseOwner,
        connection?.oauthRefreshFailureCount ?? 0,
        connection?.gymId ?? null,
        connection?.providerCode ?? null,
      );
      return { connectionId, refreshed: false, reason: 'STATE_CHANGED' };
    }

    const nextFailureCount = (connection.oauthRefreshFailureCount ?? 0) + 1;
    let newReference: string | null = null;

    try {
      const adapter = this.adapters.require(connection.providerCode);
      if (!adapter.refresh) {
        throw new ServiceUnavailableException(
          'Provider OAuth nao suporta refresh coordenado',
        );
      }

      const [tenantSecret, app] = await Promise.all([
        this.vault.getSecret(connection.secretReference),
        this.loadBoundApp(connection),
      ]);
      if (tenantSecret.version !== connection.secretVersion) {
        throw new ServiceUnavailableException(
          'Versao fisica do OAuth tenant diverge do estado canonico',
        );
      }

      const bundle = parseOAuthTokenBundle(
        tenantSecret.value,
        connection.providerCode,
      );
      if (!bundle.refreshToken) {
        throw new ServiceUnavailableException(
          'OAuth credential nao possui refresh token',
        );
      }

      const appSecret = await this.vault.getSecret(app.secretReference!);
      if (appSecret.version !== app.secretVersion) {
        throw new ServiceUnavailableException(
          'Versao fisica do OAuth App diverge do estado canonico',
        );
      }

      const governedScopes = scopes(connection.oauthGrantedScopes);
      const requestedScopes = governedScopes.length
        ? governedScopes
        : bundle.grantedScopes;
      const configuration = parseOAuthAppPublicConfiguration(
        app.publicConfiguration,
      );
      const tokenSet = await adapter.refresh({
        configuration,
        clientSecret: new IntegrationSecretValue(appSecret.value),
        refreshToken: bundle.refreshToken,
        requestedScopes,
      });

      newReference = newIntegrationSecretReference();
      const refreshedAt = new Date();
      const physical = await this.vault.putSecret({
        reference: newReference,
        value: serializeOAuthTokenBundle(
          connection.providerCode,
          tokenSet,
          refreshedAt,
        ),
      });

      await this.prisma.$transaction(
        async (tx) => {
          const changed = await tx.integrationConnection.updateMany({
            where: {
              id: connection.id,
              scope: IntegrationScope.TENANT,
              secretReference: connection.secretReference,
              secretVersion: connection.secretVersion,
              secretRevokedAt: null,
              oauthRefreshLeaseOwner: leaseOwner,
            },
            data: {
              status: IntegrationConnectionStatus.ACTIVE,
              secretReference: newReference!,
              secretVersion: physical.version,
              secretRotatedAt: refreshedAt,
              secretExpiresAt: physical.expiresAt ?? null,
              secretLastUsedAt: null,
              lastVerifiedAt: refreshedAt,
              oauthAccessExpiresAt: tokenSet.accessExpiresAt,
              oauthGrantedScopes: tokenSet.grantedScopes,
              oauthRefreshCapable: Boolean(tokenSet.refreshToken),
              oauthRefreshLeaseOwner: null,
              oauthRefreshLeaseUntil: null,
              oauthRefreshRetryAt: null,
              oauthRefreshFailureCount: 0,
              oauthLastRefreshAt: refreshedAt,
            },
          });
          if (changed.count !== 1) {
            throw new ServiceUnavailableException(
              'Lease OAuth mudou durante refresh',
            );
          }

          await this.audit.record(
            {
              gymId: connection.gymId,
              userId: null,
              action: 'INTEGRATION_OAUTH_REFRESHED',
              entity: 'IntegrationConnection',
              entityId: connection.id,
              next: {
                providerCode: connection.providerCode,
                secretVersion: physical.version,
                accessExpiresAt: tokenSet.accessExpiresAt,
                refreshCapable: Boolean(tokenSet.refreshToken),
                refreshedAt,
              },
            },
            tx,
          );
        },
        { isolationLevel: 'Serializable' },
      );

      try {
        await this.vault.revokeSecret(connection.secretReference);
      } catch {
        await this.scheduleCleanup(
          connection.id,
          connection.secretReference,
          'OAUTH_REFRESH_OLD_REFERENCE',
        ).catch(() => undefined);
      }

      return {
        connectionId,
        refreshed: true,
        accessExpiresAt: tokenSet.accessExpiresAt,
      };
    } catch {
      if (newReference) {
        try {
          await this.vault.revokeSecret(newReference);
        } catch {
          await this.scheduleCleanup(
            connection.id,
            newReference,
            'OAUTH_REFRESH_ROLLBACK_REFERENCE',
          ).catch(() => undefined);
        }
      }
      await this.releaseFailedLease(
        connection.id,
        leaseOwner,
        nextFailureCount,
        connection.gymId,
        connection.providerCode,
      );
      return {
        connectionId,
        refreshed: false,
        reason: 'PROVIDER_OR_STATE_FAILURE',
      };
    }
  }

  private async releaseFailedLease(
    connectionId: string,
    leaseOwner: string,
    failureCount: number,
    gymId: string | null,
    providerCode: string | null,
  ) {
    const retryAt = new Date(Date.now() + refreshBackoffMs(failureCount));
    const changed = await this.prisma.integrationConnection.updateMany({
      where: {
        id: connectionId,
        oauthRefreshLeaseOwner: leaseOwner,
        secretRevokedAt: null,
      },
      data: {
        status: IntegrationConnectionStatus.DEGRADED,
        oauthRefreshLeaseOwner: null,
        oauthRefreshLeaseUntil: null,
        oauthRefreshRetryAt: retryAt,
        oauthRefreshFailureCount: failureCount,
      },
    });

    if (changed.count === 1) {
      await this.audit
        .record({
          gymId,
          userId: null,
          action: 'INTEGRATION_OAUTH_REFRESH_FAILED',
          entity: 'IntegrationConnection',
          entityId: connectionId,
          next: {
            providerCode,
            failureCount,
            retryAt,
          },
        })
        .catch(() => undefined);
    }
  }

  private cleanupRetryDue(task: {
    attempts: number;
    lastAttemptAt: Date;
  }): boolean {
    const dueAt =
      task.lastAttemptAt.getTime() +
      refreshBackoffMs(Math.max(task.attempts, 1));
    return Date.now() >= dueAt;
  }

  async processPendingOAuthCleanup(limit = REFRESH_BATCH_SIZE) {
    const tasks = await this.prisma.integrationSecretCleanupTask.findMany({
      where: {
        status: IntegrationSecretCleanupStatus.PENDING,
        reason: {
          in: [OAUTH_PROVIDER_REVOKE_PENDING, OAUTH_LOCAL_REVOKE_PENDING],
        },
      },
      orderBy: { lastAttemptAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    const results = [];
    for (const task of tasks) {
      if (!this.cleanupRetryDue(task)) continue;
      results.push(await this.processCleanupTask(task));
    }
    return results;
  }

  private async processCleanupTask(task: any) {
    const connection = task.integrationConnectionId
      ? await this.prisma.integrationConnection.findUnique({
          where: { id: task.integrationConnectionId },
        })
      : null;

    try {
      if (
        task.reason === OAUTH_PROVIDER_REVOKE_PENDING &&
        connection
      ) {
        const adapter = this.adapters.require(connection.providerCode);
        if (adapter.revoke) {
          const [physical, app] = await Promise.all([
            this.vault.getSecret(task.secretReference),
            this.loadBoundApp(connection),
          ]);
          const bundle = parseOAuthTokenBundle(
            physical.value,
            connection.providerCode,
          );
          const configuration = parseOAuthAppPublicConfiguration(
            app.publicConfiguration,
          );
          await adapter.revoke({
            configuration,
            accessToken: bundle.accessToken,
            refreshToken: bundle.refreshToken,
          });
        }
      }

      await this.vault.revokeSecret(task.secretReference);
      await this.prisma.integrationSecretCleanupTask.updateMany({
        where: {
          id: task.id,
          status: IntegrationSecretCleanupStatus.PENDING,
        },
        data: {
          status: IntegrationSecretCleanupStatus.COMPLETED,
          completedAt: new Date(),
          lastAttemptAt: new Date(),
        },
      });
      return { cleanupTaskId: task.id, completed: true };
    } catch {
      await this.prisma.integrationSecretCleanupTask.updateMany({
        where: {
          id: task.id,
          status: IntegrationSecretCleanupStatus.PENDING,
        },
        data: {
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });
      return { cleanupTaskId: task.id, completed: false };
    }
  }

  async runCycle() {
    if (this.cycleRunning) return { skipped: true };
    this.cycleRunning = true;
    try {
      const cleanup = await this.processPendingOAuthCleanup();
      const refresh = await this.refreshDue();
      return { skipped: false, cleanup, refresh };
    } finally {
      this.cycleRunning = false;
    }
  }
}

export {
  OAUTH_LOCAL_REVOKE_PENDING,
  OAUTH_PROVIDER_REVOKE_PENDING,
};
