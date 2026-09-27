import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConnectionService } from './integration-connection.service';
import { IntegrationProviderRegistry } from './provider-registry.service';
import { IntegrationRuntimeEnvironmentService } from './runtime-environment.service';
import { IntegrationSecretResolverService } from './secrets/integration-secret-resolver.service';
import { INTEGRATION_SECRET_VAULT } from './secrets/integration-secret-vault.port';
import { UnavailableIntegrationSecretVaultAdapter } from './secrets/unavailable-integration-secret-vault.adapter';

@Module({
  providers: [
    PrismaService,
    IntegrationProviderRegistry,
    IntegrationConnectionService,
    IntegrationRuntimeEnvironmentService,
    UnavailableIntegrationSecretVaultAdapter,
    {
      provide: INTEGRATION_SECRET_VAULT,
      useExisting: UnavailableIntegrationSecretVaultAdapter,
    },
    IntegrationSecretResolverService,
  ],
  exports: [
    IntegrationProviderRegistry,
    IntegrationConnectionService,
    IntegrationRuntimeEnvironmentService,
    IntegrationSecretResolverService,
    INTEGRATION_SECRET_VAULT,
  ],
})
export class IntegrationsModule {}
