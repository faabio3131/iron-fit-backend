import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { IntegrationCredentialAdminService } from './integration-credential-admin.service';
import { IntegrationCredentialGlobalController } from './integration-credential-global.controller';
import { IntegrationCredentialTenantController } from './integration-credential-tenant.controller';
import { IntegrationConnectionService } from './integration-connection.service';
import { IntegrationProviderRegistry } from './provider-registry.service';
import { IntegrationRuntimeEnvironmentService } from './runtime-environment.service';
import { IntegrationSecretResolverService } from './secrets/integration-secret-resolver.service';
import { INTEGRATION_SECRET_VAULT } from './secrets/integration-secret-vault.port';
import { OciAuthenticationProviderFactory } from './secrets/oci/oci-authentication-provider.factory';
import { OciIntegrationSecretVaultAdapter } from './secrets/oci/oci-integration-secret-vault.adapter';
import { OciVaultClientFactory } from './secrets/oci/oci-vault-client.factory';
import { OciVaultConfigurationService } from './secrets/oci/oci-vault-configuration.service';
import { UnavailableIntegrationSecretVaultAdapter } from './secrets/unavailable-integration-secret-vault.adapter';

@Module({
  imports: [AuthModule],
  controllers: [
    IntegrationCredentialTenantController,
    IntegrationCredentialGlobalController,
  ],
  providers: [
    PrismaService,
    AuditService,
    IntegrationProviderRegistry,
    IntegrationConnectionService,
    IntegrationCredentialAdminService,
    IntegrationRuntimeEnvironmentService,
    OciVaultConfigurationService,
    OciAuthenticationProviderFactory,
    OciVaultClientFactory,
    OciIntegrationSecretVaultAdapter,
    UnavailableIntegrationSecretVaultAdapter,
    {
      provide: INTEGRATION_SECRET_VAULT,
      inject: [
        ConfigService,
        OciVaultConfigurationService,
        OciIntegrationSecretVaultAdapter,
        UnavailableIntegrationSecretVaultAdapter,
      ],
      useFactory: (
        config: ConfigService,
        ociConfiguration: OciVaultConfigurationService,
        ociAdapter: OciIntegrationSecretVaultAdapter,
        unavailable: UnavailableIntegrationSecretVaultAdapter,
      ) => {
        const backend = config
          .get<string>('INTEGRATION_SECRET_VAULT_BACKEND')
          ?.trim()
          .toUpperCase();

        if (backend === 'OCI') {
          ociConfiguration.requireSettings();
          return ociAdapter;
        }
        if (!backend || backend === 'DISABLED') return unavailable;

        throw new Error(
          'INTEGRATION_SECRET_VAULT_BACKEND deve ser OCI ou DISABLED',
        );
      },
    },
    IntegrationSecretResolverService,
  ],
  exports: [
    IntegrationProviderRegistry,
    IntegrationConnectionService,
    IntegrationCredentialAdminService,
    IntegrationRuntimeEnvironmentService,
    IntegrationSecretResolverService,
    INTEGRATION_SECRET_VAULT,
  ],
})
export class IntegrationsModule {}
