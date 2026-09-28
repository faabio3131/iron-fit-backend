import {
  ConflictException,
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
  newIntegrationSecretReference,
} from './contracts/integration-contract';
import { IntegrationOAuthCoreService } from './integration-oauth-core.service';
import {
  IntegrationOAuthProviderAdapterRegistry,
  OAuthTokenSet,
  parseOAuthAppPublicConfiguration,
} from './integration-oauth-provider-adapters';
import {
  INTEGRATION_SECRET_VAULT,
  IntegrationSecretValue,
  IntegrationSecretVaultPort,
} from './secrets/integration-secret-vault.port';
import { Inject } from '@nestjs/common';

type OAuthVaultBundle = {
  schemaVersion: 1;
  providerCode: string;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  grantedScopes: string[];
  issuedAt: string;
  accessExpiresAt: string | null;
};

function minDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left <= right ? left : right;
}

function serializeTokenBundle(
  providerCode: string,
  tokenSet: OAuthTokenSet,
  issuedAt: Date,
): string {
  const bundle: OAuthVaultBundle = {
    schemaVersion: 1,
    providerCode,
    accessToken: tokenSet.accessToken.reveal(),
    refreshToken: tokenSet.refreshToken?.reveal() ?? null,
    tokenType: tokenSet.tokenType,
    grantedScopes: [...tokenSet.grantedScopes],
    issuedAt: issuedAt.toISOString(),
    accessExpiresAt: tokenSet.accessExpiresAt?.toISOString() ?? null,
  };
  return JSON.stringify(bundle);
}

@Injectable()
export class IntegrationOAuthProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oauthCore: IntegrationOAuthCoreService,
    private readonly adapters: IntegrationOAuthProviderAdapterRegistry,
    private readonly audit: AuditService,
    @Inject(INTEGRATION_SECRET_VAULT)
    private readonly vault: IntegrationSecretVaultPort,
  ) {}

  private async scheduleCleanup(
    connectionId: string | null,
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

  private async revokeLocalReference(
    connectionId: string | null,
    reference: string | null | undefined,
    reason: string,
  ) {
    if (!reference) return true;
    try {
      await this.vault.revokeSecret(reference);
      return true;
    } catch {
      await this.scheduleCleanup(connectionId, reference, reason).catch(
        () => undefined,
      );
      return false;
    }
  }

  async completeCallback(
    providerCodeInput: string,
    state: string,
    authorizationCode: string,
  ) {
    const claimed = await this.oauthCore.claimCallback(
      providerCodeInput,
      state,
      authorizationCode,
    );

    const providerCode = claimed.providerCode;
    const adapter = this.adapters.require(providerCode);

    try {
      const [tenantConnection, appConnection] = await Promise.all([
        this.prisma.integrationConnection.findUnique({
          where: { id: claimed.connectionId },
        }),
        this.prisma.integrationConnection.findUnique({
          where: { id: claimed.appConnectionId },
        }),
      ]);

      if (
        !tenantConnection ||
        tenantConnection.scope !== IntegrationScope.TENANT ||
        tenantConnection.gymId !== claimed.gymId ||
        tenantConnection.providerCode !== providerCode ||
        tenantConnection.environment !== claimed.environment ||
        tenantConnection.authModel !== 'OAUTH2' ||
        tenantConnection.status === IntegrationConnectionStatus.SUSPENDED ||
        tenantConnection.status === IntegrationConnectionStatus.DISCONNECTED
      ) {
        throw new ConflictException(
          'Conexao OAuth tenant mudou durante callback',
        );
      }

      if (
        !appConnection ||
        appConnection.scope !== IntegrationScope.GLOBAL ||
        appConnection.gymId !== null ||
        appConnection.providerCode !== providerCode ||
        appConnection.environment !== claimed.environment ||
        appConnection.authModel !== 'OAUTH2' ||
        appConnection.status !== IntegrationConnectionStatus.ACTIVE ||
        !appConnection.secretReference ||
        !appConnection.secretVersion ||
        appConnection.secretRevokedAt
      ) {
        throw new ServiceUnavailableException(
          'OAuth App global perdeu autoridade durante callback',
        );
      }

      const appSecret = await this.vault.getSecret(
        appConnection.secretReference,
      );
      if (appSecret.version !== appConnection.secretVersion) {
        throw new ServiceUnavailableException(
          'Versao fisica do OAuth App diverge do estado canonico',
        );
      }

      const configuration = parseOAuthAppPublicConfiguration(
        appConnection.publicConfiguration,
      );
      const tokenSet = await adapter.exchange({
        configuration,
        clientSecret: new IntegrationSecretValue(appSecret.value),
        authorizationCode: claimed.authorizationCode,
        redirectUri: claimed.redirectUri,
        requestedScopes: claimed.scopes,
        pkceVerifier: claimed.pkceVerifier,
      });

      const issuedAt = new Date();
      const newReference = newIntegrationSecretReference();
      const previousReference = tenantConnection.secretReference;
      const previousVersion = tenantConnection.secretVersion;

      let physical: { version: number; expiresAt?: Date | null };
      try {
        physical = await this.vault.putSecret({
          reference: newReference,
          value: serializeTokenBundle(providerCode, tokenSet, issuedAt),
        });
      } catch (error) {
        if (adapter.revoke) {
          await adapter
            .revoke({
              configuration,
              accessToken: tokenSet.accessToken,
              refreshToken: tokenSet.refreshToken,
            })
            .catch(() => undefined);
        }
        throw error;
      }

      const providerUsableUntil = tokenSet.refreshToken
        ? null
        : tokenSet.accessExpiresAt;
      const credentialExpiresAt = minDate(
        physical.expiresAt ?? null,
        providerUsableUntil,
      );

      try {
        await this.prisma.$transaction(
          async (tx) => {
            const changed = await tx.integrationConnection.updateMany({
              where: {
                id: tenantConnection.id,
                scope: IntegrationScope.TENANT,
                gymId: claimed.gymId,
                providerCode,
                environment: claimed.environment,
                authModel: 'OAUTH2',
                status: {
                  in: [
                    IntegrationConnectionStatus.PENDING,
                    IntegrationConnectionStatus.ACTIVE,
                    IntegrationConnectionStatus.DEGRADED,
                  ],
                },
                secretReference: previousReference,
                secretVersion: previousVersion,
              },
              data: {
                status: IntegrationConnectionStatus.ACTIVE,
                secretReference: newReference,
                secretVersion: physical.version,
                secretRotatedAt: issuedAt,
                secretExpiresAt: credentialExpiresAt,
                secretLastUsedAt: null,
                secretRevokedAt: null,
                lastVerifiedAt: issuedAt,
                oauthAppConnectionId: appConnection.id,
                oauthAccessExpiresAt: tokenSet.accessExpiresAt,
                oauthGrantedScopes: tokenSet.grantedScopes,
                oauthRefreshCapable: Boolean(tokenSet.refreshToken),
              },
            });
            if (changed.count !== 1) {
              throw new ConflictException(
                'Conexao OAuth mudou durante persistencia do token',
              );
            }

            await this.audit.record(
              {
                gymId: claimed.gymId,
                userId: claimed.userId,
                action: 'INTEGRATION_OAUTH_CONNECTED',
                entity: 'IntegrationConnection',
                entityId: tenantConnection.id,
                next: {
                  providerCode,
                  environment: claimed.environment,
                  oauthAppConnectionId: appConnection.id,
                  grantedScopes: tokenSet.grantedScopes,
                  refreshCapable: Boolean(tokenSet.refreshToken),
                  accessExpiresAt: tokenSet.accessExpiresAt,
                  secretVersion: physical.version,
                  credentialConfigured: true,
                },
              },
              tx,
            );
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        await this.revokeLocalReference(
          tenantConnection.id,
          newReference,
          'OAUTH_CALLBACK_ROLLBACK_NEW_REFERENCE',
        );
        if (adapter.revoke) {
          await adapter
            .revoke({
              configuration,
              accessToken: tokenSet.accessToken,
              refreshToken: tokenSet.refreshToken,
            })
            .catch(() => undefined);
        }
        throw error;
      }

      const previousCredentialRevoked =
        !previousReference ||
        previousReference === newReference ||
        (await this.revokeLocalReference(
          tenantConnection.id,
          previousReference,
          'OAUTH_REAUTHORIZE_OLD_REFERENCE',
        ));

      return {
        providerCode,
        connectionId: tenantConnection.id,
        connected: true,
        refreshCapable: Boolean(tokenSet.refreshToken),
        grantedScopes: tokenSet.grantedScopes,
        accessExpiresAt: tokenSet.accessExpiresAt,
        previousCredentialRevoked,
      };
    } finally {
      await this.revokeLocalReference(
        claimed.connectionId,
        claimed.pkceSecretReference,
        'OAUTH_PKCE_CONSUMED_REFERENCE',
      );
    }
  }
}
