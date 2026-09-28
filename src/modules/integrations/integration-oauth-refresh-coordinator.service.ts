import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationScope,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IntegrationOAuthProviderAdapterRegistry,
  parseOAuthProviderConfiguration,
} from './integration-oauth-provider.adapter';
import { IntegrationOAuthTokenService } from './integration-oauth-token.service';
import { IntegrationSecretResolverService } from './secrets/integration-secret-resolver.service';

const REFRESH_LEASE_MS = 30_000;
const DEFAULT_MIN_VALIDITY_SECONDS = 120;

function leaseHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function publicConfig(connection: any): Readonly<Record<string, unknown>> {
  if (
    !connection?.publicConfiguration ||
    typeof connection.publicConfiguration !== 'object' ||
    Array.isArray(connection.publicConfiguration)
  ) {
    throw new ServiceUnavailableException(
      'OAuth App global sem publicConfiguration valida',
    );
  }
  return connection.publicConfiguration as Record<string, unknown>;
}

@Injectable()
export class IntegrationOAuthRefreshCoordinator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: IntegrationOAuthTokenService,
    private readonly adapters: IntegrationOAuthProviderAdapterRegistry,
    private readonly resolver: IntegrationSecretResolverService,
    private readonly audit: AuditService,
  ) {}

  private async requireReauthorization(
    connectionId: string,
    reason: string,
  ): Promise<never> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.integrationOAuthTokenState.updateMany({
        where: { connectionId },
        data: {
          reauthRequiredAt: now,
          refreshLeaseHash: null,
          refreshLeaseUntil: null,
          lastErrorCode: reason,
        },
      });
      await tx.integrationConnection.updateMany({
        where: {
          id: connectionId,
          scope: IntegrationScope.TENANT,
          status: IntegrationConnectionStatus.ACTIVE,
        },
        data: { status: IntegrationConnectionStatus.DEGRADED },
      });
      const connection = await tx.integrationConnection.findUnique({
        where: { id: connectionId },
      });
      await this.audit.record(
        {
          gymId: connection?.gymId ?? null,
          action: 'INTEGRATION_OAUTH_REAUTH_REQUIRED',
          entity: 'IntegrationConnection',
          entityId: connectionId,
          next: { reason, reauthRequiredAt: now },
        },
        tx,
      );
    });
    throw new ServiceUnavailableException(
      'OAuth connection exige reautorizacao',
    );
  }

  async ensureFreshAccessToken(
    connectionId: string,
    minValiditySeconds = DEFAULT_MIN_VALIDITY_SECONDS,
  ) {
    if (
      !Number.isInteger(minValiditySeconds) ||
      minValiditySeconds < 0 ||
      minValiditySeconds > 3600
    ) {
      throw new BadRequestException(
        'minValiditySeconds fora do intervalo permitido',
      );
    }

    const current = await this.tokens.loadForRuntime(connectionId);
    const expiresAt = current.tokenState.accessTokenExpiresAt as Date | null;
    const threshold = new Date(Date.now() + minValiditySeconds * 1000);
    if (!expiresAt || expiresAt > threshold) {
      return {
        connectionId,
        accessToken: current.accessToken,
        expiresAt,
        refreshed: false,
      };
    }

    if (!current.refreshToken) {
      return this.requireReauthorization(
        connectionId,
        'REFRESH_TOKEN_UNAVAILABLE',
      );
    }

    const appConnection = await this.prisma.integrationConnection.findFirst({
      where: {
        id: current.tokenState.appConnectionId,
        scope: IntegrationScope.GLOBAL,
        gymId: null,
        providerCode: current.connection.providerCode,
        environment: current.connection.environment,
        status: IntegrationConnectionStatus.ACTIVE,
      },
    });
    if (!appConnection) {
      return this.requireReauthorization(
        connectionId,
        'OAUTH_APP_CONNECTION_UNAVAILABLE',
      );
    }

    const configuration = parseOAuthProviderConfiguration(
      publicConfig(appConnection),
    );
    if (configuration.refreshMode !== 'REFRESH_TOKEN') {
      return this.requireReauthorization(
        connectionId,
        'PROVIDER_REQUIRES_REAUTHORIZATION',
      );
    }

    const leaseSecret = randomBytes(32).toString('base64url');
    const hash = leaseHash(leaseSecret);
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + REFRESH_LEASE_MS);
    const acquired = await this.prisma.integrationOAuthTokenState.updateMany({
      where: {
        connectionId,
        reauthRequiredAt: null,
        OR: [
          { refreshLeaseUntil: null },
          { refreshLeaseUntil: { lte: now } },
        ],
      },
      data: {
        refreshLeaseHash: hash,
        refreshLeaseUntil: leaseUntil,
      },
    });

    if (acquired.count !== 1) {
      const latest = await this.tokens.loadForRuntime(connectionId);
      const latestExpiry = latest.tokenState.accessTokenExpiresAt as Date | null;
      if (!latestExpiry || latestExpiry > new Date()) {
        return {
          connectionId,
          accessToken: latest.accessToken,
          expiresAt: latestExpiry,
          refreshed: false,
          refreshInProgress: true,
        };
      }
      throw new ConflictException(
        'OAuth refresh concorrente em andamento',
      );
    }

    try {
      const clientSecret = await this.resolver.resolveForExternalBoundary(
        appConnection.id,
        { scope: IntegrationScope.GLOBAL },
      );
      const adapter = this.adapters.require(current.connection.providerCode);
      const bundle = await adapter.refresh({
        providerCode: current.connection.providerCode,
        publicConfiguration: publicConfig(appConnection),
        clientSecret,
        refreshToken: current.refreshToken,
        previousScopes: Array.isArray(current.tokenState.grantedScopes)
          ? current.tokenState.grantedScopes.filter(
              (value: unknown): value is string => typeof value === 'string',
            )
          : [],
      });

      await this.tokens.persistRefreshedBundle(
        connectionId,
        current.connection.secretVersion,
        bundle,
        current.refreshToken,
        hash,
      );

      const fresh = await this.tokens.loadForRuntime(connectionId);
      return {
        connectionId,
        accessToken: fresh.accessToken,
        expiresAt: fresh.tokenState.accessTokenExpiresAt as Date | null,
        refreshed: true,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException &&
        /reautorizacao/i.test(error.message)
      ) {
        return this.requireReauthorization(
          connectionId,
          'PROVIDER_REQUIRES_REAUTHORIZATION',
        );
      }

      await this.prisma.integrationOAuthTokenState.updateMany({
        where: { connectionId, refreshLeaseHash: hash },
        data: {
          refreshLeaseHash: null,
          refreshLeaseUntil: null,
          lastErrorCode: 'REFRESH_FAILED',
        },
      });
      throw error;
    }
  }
}
