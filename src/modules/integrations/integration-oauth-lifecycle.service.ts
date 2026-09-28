import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationScope,
  IntegrationSecretCleanupStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IntegrationOAuthProviderAdapterRegistry,
  parseOAuthAppPublicConfiguration,
} from './integration-oauth-provider-adapters';
import {
  OAUTH_LOCAL_REVOKE_PENDING,
  OAUTH_PROVIDER_REVOKE_PENDING,
} from './integration-oauth-maintenance.service';
import { parseOAuthTokenBundle } from './integration-oauth-token-bundle';
import {
  INTEGRATION_SECRET_VAULT,
  IntegrationSecretVaultPort,
} from './secrets/integration-secret-vault.port';

@Injectable()
export class IntegrationOAuthLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: IntegrationOAuthProviderAdapterRegistry,
    private readonly audit: AuditService,
    @Inject(INTEGRATION_SECRET_VAULT)
    private readonly vault: IntegrationSecretVaultPort,
  ) {}

  private async scheduleCleanup(
    connectionId: string,
    secretReference: string,
    reason: string,
  ) {
    const now = new Date();
    await this.prisma.integrationSecretCleanupTask.upsert({
      where: { secretReference },
      create: {
        integrationConnectionId: connectionId,
        secretReference,
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
      app.secretRevokedAt
    ) {
      throw new ServiceUnavailableException(
        'OAuth App global vinculado indisponivel para revogacao',
      );
    }
    return app;
  }

  private async pendingCleanup(reference: string) {
    return this.prisma.integrationSecretCleanupTask.findUnique({
      where: { secretReference: reference },
    });
  }

  async disconnect(
    connection: any,
    userId: string,
    gymId: string | null,
  ) {
    if (
      connection.scope !== IntegrationScope.TENANT ||
      connection.authModel !== 'OAUTH2' ||
      !connection.secretReference ||
      !connection.secretVersion
    ) {
      throw new ConflictException(
        'Conexao OAuth tenant sem credencial ativa para desconexao',
      );
    }

    if (
      connection.status === IntegrationConnectionStatus.DISCONNECTED ||
      connection.secretRevokedAt
    ) {
      const pending = await this.pendingCleanup(connection.secretReference);
      const pendingRetry =
        pending?.status === IntegrationSecretCleanupStatus.PENDING;
      return {
        id: connection.id,
        revoked: true,
        revokedAt: connection.secretRevokedAt,
        providerRevocation: pendingRetry ? 'PENDING_RETRY' : 'COMPLETED',
        physicalRevocation: pendingRetry ? 'PENDING_RETRY' : 'COMPLETED',
        idempotent: true,
      };
    }

    const revokedAt = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        const changed = await tx.integrationConnection.updateMany({
          where: {
            id: connection.id,
            scope: IntegrationScope.TENANT,
            gymId,
            authModel: 'OAUTH2',
            secretReference: connection.secretReference,
            secretVersion: connection.secretVersion,
            secretRevokedAt: null,
          },
          data: {
            status: IntegrationConnectionStatus.DISCONNECTED,
            secretRevokedAt: revokedAt,
            oauthRefreshLeaseOwner: null,
            oauthRefreshLeaseUntil: null,
            oauthRefreshRetryAt: null,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException(
            'Conexao OAuth mudou durante desconexao',
          );
        }

        await this.audit.record(
          {
            gymId,
            userId,
            action: 'INTEGRATION_OAUTH_DISCONNECTED',
            entity: 'IntegrationConnection',
            entityId: connection.id,
            previous: {
              status: connection.status,
              secretVersion: connection.secretVersion,
              refreshCapable: connection.oauthRefreshCapable,
            },
            next: {
              status: IntegrationConnectionStatus.DISCONNECTED,
              secretRevokedAt: revokedAt,
              refreshLeaseCleared: true,
            },
          },
          tx,
        );
      },
      { isolationLevel: 'Serializable' },
    );

    const adapter = this.adapters.require(connection.providerCode);

    if (!adapter.revoke) {
      try {
        await this.vault.revokeSecret(connection.secretReference);
        return {
          id: connection.id,
          revoked: true,
          revokedAt,
          providerRevocation: 'UNSUPPORTED',
          physicalRevocation: 'COMPLETED',
          idempotent: false,
        };
      } catch {
        await this.scheduleCleanup(
          connection.id,
          connection.secretReference,
          OAUTH_LOCAL_REVOKE_PENDING,
        );
        return {
          id: connection.id,
          revoked: true,
          revokedAt,
          providerRevocation: 'UNSUPPORTED',
          physicalRevocation: 'PENDING_RETRY',
          idempotent: false,
        };
      }
    }

    try {
      const [physical, app] = await Promise.all([
        this.vault.getSecret(connection.secretReference),
        this.loadBoundApp(connection),
      ]);
      if (physical.version !== connection.secretVersion) {
        throw new ServiceUnavailableException(
          'Versao fisica do OAuth tenant diverge durante revogacao',
        );
      }
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
      await this.vault.revokeSecret(connection.secretReference);

      return {
        id: connection.id,
        revoked: true,
        revokedAt,
        providerRevocation: 'COMPLETED',
        physicalRevocation: 'COMPLETED',
        idempotent: false,
      };
    } catch {
      await this.scheduleCleanup(
        connection.id,
        connection.secretReference,
        OAUTH_PROVIDER_REVOKE_PENDING,
      );
      return {
        id: connection.id,
        revoked: true,
        revokedAt,
        providerRevocation: 'PENDING_RETRY',
        physicalRevocation: 'DEFERRED_FOR_PROVIDER_RETRY',
        idempotent: false,
      };
    }
  }
}
