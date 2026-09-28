import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  newIntegrationSecretReference,
} from './contracts/integration-contract';
import {
  OAuthTokenBundle,
} from './integration-oauth-provider.adapter';
import {
  INTEGRATION_SECRET_VAULT,
  IntegrationSecretValue,
  IntegrationSecretVaultPort,
} from './secrets/integration-secret-vault.port';

type ClaimedOAuthCallback = {
  attemptId: string;
  providerCode: string;
  environment: IntegrationEnvironment | string;
  connectionId: string;
  appConnectionId: string;
  gymId: string;
  userId: string;
  scopes: string[];
  pkceSecretReference: string | null;
};

type StoredTokenBundle = {
  schemaVersion: 1;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  grantedScopes: string[];
  accessTokenExpiresAt: string | null;
};

function safeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.filter((scope) => Boolean(scope.trim())).map((scope) => scope.trim()))].sort();
}

function parseStoredBundle(value: string): StoredTokenBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ServiceUnavailableException(
      'OAuth token bundle fisico invalido',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ServiceUnavailableException('OAuth token bundle fisico invalido');
  }
  const raw = parsed as Record<string, unknown>;
  if (
    raw.schemaVersion !== 1 ||
    typeof raw.accessToken !== 'string' ||
    !raw.accessToken ||
    !(
      raw.refreshToken === null ||
      (typeof raw.refreshToken === 'string' && raw.refreshToken)
    ) ||
    !(
      raw.tokenType === null ||
      typeof raw.tokenType === 'string'
    ) ||
    !Array.isArray(raw.grantedScopes) ||
    raw.grantedScopes.some((scope) => typeof scope !== 'string') ||
    !(
      raw.accessTokenExpiresAt === null ||
      typeof raw.accessTokenExpiresAt === 'string'
    )
  ) {
    throw new ServiceUnavailableException('OAuth token bundle fisico invalido');
  }
  return {
    schemaVersion: 1,
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken as string | null,
    tokenType: raw.tokenType as string | null,
    grantedScopes: safeScopes(raw.grantedScopes as string[]),
    accessTokenExpiresAt: raw.accessTokenExpiresAt as string | null,
  };
}

@Injectable()
export class IntegrationOAuthTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(INTEGRATION_SECRET_VAULT)
    private readonly vault: IntegrationSecretVaultPort,
  ) {}

  private serialize(
    bundle: OAuthTokenBundle,
    previousRefreshToken: string | null,
  ): StoredTokenBundle {
    return {
      schemaVersion: 1,
      accessToken: bundle.accessToken.reveal(),
      refreshToken:
        bundle.refreshToken?.reveal() ?? previousRefreshToken ?? null,
      tokenType: bundle.tokenType,
      grantedScopes: safeScopes(bundle.grantedScopes),
      accessTokenExpiresAt:
        bundle.accessTokenExpiresAt?.toISOString() ?? null,
    };
  }

  private async previousRefreshToken(connection: any): Promise<string | null> {
    if (
      !connection.secretReference ||
      !connection.secretVersion ||
      connection.secretRevokedAt
    ) {
      return null;
    }
    const snapshot = await this.vault.getSecret(connection.secretReference);
    if (snapshot.version !== connection.secretVersion) {
      throw new ServiceUnavailableException(
        'OAuth token secret version diverge do estado canonico',
      );
    }
    return parseStoredBundle(snapshot.value).refreshToken;
  }

  private async queueCleanup(
    connectionId: string,
    secretReference: string,
    reason: string,
  ) {
    await this.prisma.integrationSecretCleanupTask.upsert({
      where: { secretReference },
      create: {
        integrationConnectionId: connectionId,
        secretReference,
        reason,
        status: 'PENDING',
      },
      update: {
        integrationConnectionId: connectionId,
        reason,
        status: 'PENDING',
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        completedAt: null,
      },
    });
  }

  private async revokeOrQueue(
    connectionId: string,
    secretReference: string | null | undefined,
    reason: string,
  ) {
    if (!secretReference) return;
    try {
      await this.vault.revokeSecret(secretReference);
    } catch {
      await this.queueCleanup(connectionId, secretReference, reason);
    }
  }

  async completeAuthorization(
    claim: ClaimedOAuthCallback,
    bundle: OAuthTokenBundle,
  ) {
    const environment = claim.environment as IntegrationEnvironment;
    const connection = await this.prisma.integrationConnection.findFirst({
      where: {
        id: claim.connectionId,
        scope: IntegrationScope.TENANT,
        gymId: claim.gymId,
        providerCode: claim.providerCode,
        environment,
        status: { not: IntegrationConnectionStatus.DISCONNECTED },
      },
    });
    if (!connection) {
      throw new ConflictException(
        'OAuth tenant connection deixou de ser valida',
      );
    }

    const previousRefreshToken =
      await this.previousRefreshToken(connection);
    const stored = this.serialize(bundle, previousRefreshToken);
    const reference = newIntegrationSecretReference();
    const physical = await this.vault.putSecret({
      reference,
      value: JSON.stringify(stored),
    });
    const now = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.integrationConnection.updateMany({
          where: {
            id: connection.id,
            scope: IntegrationScope.TENANT,
            gymId: claim.gymId,
            providerCode: claim.providerCode,
            environment,
            status: { not: IntegrationConnectionStatus.DISCONNECTED },
          },
          data: {
            status: IntegrationConnectionStatus.ACTIVE,
            secretReference: reference,
            secretVersion: physical.version,
            secretRotatedAt: now,
            secretExpiresAt: null,
            secretRevokedAt: null,
            secretLastUsedAt: null,
            lastVerifiedAt: now,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException(
            'OAuth tenant connection mudou durante token commit',
          );
        }

        await tx.integrationOAuthTokenState.upsert({
          where: { connectionId: connection.id },
          create: {
            connectionId: connection.id,
            appConnectionId: claim.appConnectionId,
            providerCode: claim.providerCode,
            environment,
            tokenType: stored.tokenType,
            grantedScopes: stored.grantedScopes,
            accessTokenExpiresAt: stored.accessTokenExpiresAt
              ? new Date(stored.accessTokenExpiresAt)
              : null,
            refreshAvailable: Boolean(stored.refreshToken),
            refreshGeneration: 0,
            refreshLeaseHash: null,
            refreshLeaseUntil: null,
            lastRefreshAt: null,
            reauthRequiredAt: null,
            lastErrorCode: null,
          },
          update: {
            appConnectionId: claim.appConnectionId,
            providerCode: claim.providerCode,
            environment,
            tokenType: stored.tokenType,
            grantedScopes: stored.grantedScopes,
            accessTokenExpiresAt: stored.accessTokenExpiresAt
              ? new Date(stored.accessTokenExpiresAt)
              : null,
            refreshAvailable: Boolean(stored.refreshToken),
            refreshGeneration: { increment: 1 },
            refreshLeaseHash: null,
            refreshLeaseUntil: null,
            reauthRequiredAt: null,
            lastErrorCode: null,
          },
        });

        await this.audit.record(
          {
            gymId: claim.gymId,
            userId: claim.userId,
            action: 'INTEGRATION_OAUTH_CONNECTED',
            entity: 'IntegrationConnection',
            entityId: connection.id,
            next: {
              providerCode: claim.providerCode,
              environment,
              status: IntegrationConnectionStatus.ACTIVE,
              grantedScopes: stored.grantedScopes,
              accessTokenExpiresAt: stored.accessTokenExpiresAt,
              refreshAvailable: Boolean(stored.refreshToken),
              appConnectionId: claim.appConnectionId,
            },
          },
          tx,
        );
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await this.vault.revokeSecret(reference).catch(() => undefined);
      throw error;
    }

    if (
      connection.secretReference &&
      connection.secretReference !== reference
    ) {
      await this.revokeOrQueue(
        connection.id,
        connection.secretReference,
        'OAUTH_TOKEN_ROTATED',
      );
    }
    await this.revokeOrQueue(
      connection.id,
      claim.pkceSecretReference,
      'OAUTH_PKCE_CONSUMED',
    );

    return {
      connectionId: connection.id,
      providerCode: claim.providerCode,
      environment,
      status: IntegrationConnectionStatus.ACTIVE,
      grantedScopes: stored.grantedScopes,
      accessTokenExpiresAt: stored.accessTokenExpiresAt,
      refreshAvailable: Boolean(stored.refreshToken),
    };
  }

  async loadForRuntime(
    connectionId: string,
  ): Promise<{
    connection: any;
    tokenState: any;
    accessToken: IntegrationSecretValue;
    refreshToken: IntegrationSecretValue | null;
  }> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { id: connectionId },
    });
    if (
      !connection ||
      connection.scope !== IntegrationScope.TENANT ||
      connection.status !== IntegrationConnectionStatus.ACTIVE ||
      !connection.secretReference ||
      !connection.secretVersion ||
      connection.secretRevokedAt
    ) {
      throw new ServiceUnavailableException(
        'OAuth tenant connection nao esta utilizavel',
      );
    }
    const tokenState =
      await this.prisma.integrationOAuthTokenState.findUnique({
        where: { connectionId },
      });
    if (!tokenState || tokenState.reauthRequiredAt) {
      throw new ServiceUnavailableException(
        'OAuth tenant token exige reautorizacao',
      );
    }

    const physical = await this.vault.getSecret(connection.secretReference);
    if (physical.version !== connection.secretVersion) {
      throw new ServiceUnavailableException(
        'OAuth token version diverge do estado canonico',
      );
    }
    const stored = parseStoredBundle(physical.value);
    return {
      connection,
      tokenState,
      accessToken: new IntegrationSecretValue(stored.accessToken),
      refreshToken: stored.refreshToken
        ? new IntegrationSecretValue(stored.refreshToken)
        : null,
    };
  }

  async persistRefreshedBundle(
    connectionId: string,
    expectedSecretVersion: number,
    bundle: OAuthTokenBundle,
    existingRefreshToken: IntegrationSecretValue,
    leaseHash: string,
  ) {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { id: connectionId },
    });
    if (
      !connection ||
      !connection.secretReference ||
      connection.secretVersion !== expectedSecretVersion ||
      connection.status !== IntegrationConnectionStatus.ACTIVE
    ) {
      throw new ConflictException(
        'OAuth connection mudou durante refresh',
      );
    }

    const stored = this.serialize(
      bundle,
      bundle.refreshToken ? null : existingRefreshToken.reveal(),
    );
    const physical = await this.vault.putSecret({
      reference: connection.secretReference,
      value: JSON.stringify(stored),
      expectedVersion: expectedSecretVersion,
    });
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.integrationConnection.updateMany({
        where: {
          id: connectionId,
          secretReference: connection.secretReference,
          secretVersion: expectedSecretVersion,
          secretRevokedAt: null,
          status: IntegrationConnectionStatus.ACTIVE,
        },
        data: {
          secretVersion: physical.version,
          secretRotatedAt: now,
          secretLastUsedAt: now,
          lastVerifiedAt: now,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'OAuth connection mudou durante commit do refresh',
        );
      }

      const state = await tx.integrationOAuthTokenState.updateMany({
        where: {
          connectionId,
          refreshLeaseHash: leaseHash,
          refreshLeaseUntil: { gt: now },
        },
        data: {
          tokenType: stored.tokenType,
          grantedScopes: stored.grantedScopes,
          accessTokenExpiresAt: stored.accessTokenExpiresAt
            ? new Date(stored.accessTokenExpiresAt)
            : null,
          refreshAvailable: Boolean(stored.refreshToken),
          refreshGeneration: { increment: 1 },
          refreshLeaseHash: null,
          refreshLeaseUntil: null,
          lastRefreshAt: now,
          reauthRequiredAt: null,
          lastErrorCode: null,
        },
      });
      if (state.count !== 1) {
        throw new ConflictException(
          'OAuth refresh lease deixou de ser valido',
        );
      }

      await this.audit.record(
        {
          gymId: connection.gymId,
          action: 'INTEGRATION_OAUTH_TOKEN_REFRESHED',
          entity: 'IntegrationConnection',
          entityId: connectionId,
          next: {
            providerCode: connection.providerCode,
            environment: connection.environment,
            accessTokenExpiresAt: stored.accessTokenExpiresAt,
            refreshAvailable: Boolean(stored.refreshToken),
          },
        },
        tx,
      );
      return physical.version;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { secretVersion: updated };
  }
}
