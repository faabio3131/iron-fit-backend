import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IntegrationScope } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationOAuthCoreService } from './integration-oauth-core.service';
import {
  IntegrationOAuthProviderAdapterRegistry,
} from './integration-oauth-provider.adapter';
import { IntegrationOAuthTokenService } from './integration-oauth-token.service';
import { IntegrationSecretResolverService } from './secrets/integration-secret-resolver.service';

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
export class IntegrationOAuthAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: IntegrationOAuthCoreService,
    private readonly adapters: IntegrationOAuthProviderAdapterRegistry,
    private readonly resolver: IntegrationSecretResolverService,
    private readonly tokens: IntegrationOAuthTokenService,
    private readonly audit: AuditService,
  ) {}

  async completeCallback(
    providerCode: string,
    state: string,
    code: string,
  ) {
    const claim = await this.core.claimCallback(providerCode, state, code);
    const appConnection = await this.prisma.integrationConnection.findUnique({
      where: { id: claim.appConnectionId },
    });
    if (!appConnection) {
      await this.tokens.cleanupEphemeralSecret(
        claim.connectionId,
        claim.pkceSecretReference,
        'OAUTH_CALLBACK_APP_CONNECTION_MISSING',
      );
      throw new ServiceUnavailableException(
        'OAuth App global nao encontrado apos callback',
      );
    }

    const adapter = this.adapters.require(providerCode);
    let bundle;
    try {
      const clientSecret = await this.resolver.resolveForExternalBoundary(
        appConnection.id,
        { scope: IntegrationScope.GLOBAL },
      );
      bundle = await adapter.exchangeCode({
        providerCode,
        publicConfiguration: publicConfig(appConnection),
        clientSecret,
        authorizationCode: claim.authorizationCode,
        redirectUri: claim.redirectUri,
        pkceVerifier: claim.pkceVerifier,
        requestedScopes: claim.scopes,
      });
    } catch (error) {
      await this.tokens.cleanupEphemeralSecret(
        claim.connectionId,
        claim.pkceSecretReference,
        'OAUTH_TOKEN_EXCHANGE_FAILED',
      );
      await this.audit.record({
        gymId: claim.gymId,
        userId: claim.userId,
        action: 'INTEGRATION_OAUTH_TOKEN_EXCHANGE_FAILED',
        entity: 'IntegrationConnection',
        entityId: claim.connectionId,
        next: {
          providerCode,
          environment: claim.environment,
          reason:
            error instanceof BadRequestException
              ? 'provider_requires_reauthorization'
              : 'provider_exchange_failed',
        },
      });
      throw error;
    }

    return this.tokens.completeAuthorization(claim, bundle);
  }
}
