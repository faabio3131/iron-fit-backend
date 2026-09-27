import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { INTEGRATION_VAULT } from './contracts/integration-vault.port';
import { IntegrationProviderRegistry } from './integration-provider.registry';
import { IntegrationSecretReferenceService } from './integration-secret-reference.service';
import { IntegrationSecretResolverService } from './integration-secret-resolver.service';
import { IntegrationsAdminController } from './integrations-admin.controller';
import { IntegrationsAdminService } from './integrations-admin.service';
import { OpenBaoIntegrationVaultAdapter } from './vault/openbao-integration-vault.adapter';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [IntegrationsAdminController],
  providers: [
    PrismaService,
    AuditService,
    IntegrationProviderRegistry,
    IntegrationSecretReferenceService,
    OpenBaoIntegrationVaultAdapter,
    {
      provide: INTEGRATION_VAULT,
      useExisting: OpenBaoIntegrationVaultAdapter,
    },
    IntegrationSecretResolverService,
    IntegrationsAdminService,
  ],
  exports: [
    IntegrationProviderRegistry,
    IntegrationSecretReferenceService,
    IntegrationSecretResolverService,
    IntegrationsAdminService,
    INTEGRATION_VAULT,
  ],
})
export class IntegrationsModule {}
