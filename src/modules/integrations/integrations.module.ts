import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { INTEGRATION_VAULT } from './contracts/integration-vault.port';
import { IntegrationProviderRegistry } from './integration-provider.registry';
import { IntegrationSecretReferenceService } from './integration-secret-reference.service';
import { IntegrationSecretResolverService } from './integration-secret-resolver.service';
import { OpenBaoIntegrationVaultAdapter } from './vault/openbao-integration-vault.adapter';

@Module({
  imports: [ConfigModule],
  providers: [
    PrismaService,
    IntegrationProviderRegistry,
    IntegrationSecretReferenceService,
    OpenBaoIntegrationVaultAdapter,
    {
      provide: INTEGRATION_VAULT,
      useExisting: OpenBaoIntegrationVaultAdapter,
    },
    IntegrationSecretResolverService,
  ],
  exports: [
    IntegrationProviderRegistry,
    IntegrationSecretReferenceService,
    IntegrationSecretResolverService,
    INTEGRATION_VAULT,
  ],
})
export class IntegrationsModule {}
