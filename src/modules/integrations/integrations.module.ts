import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { IntegrationBreakGlassController } from './integration-break-glass.controller';
import { IntegrationBreakGlassService } from './integration-break-glass.service';
import { IntegrationCredentialAdminService } from './integration-credential-admin.service';
import { IntegrationCredentialGlobalController } from './integration-credential-global.controller';
import { IntegrationCredentialTenantController } from './integration-credential-tenant.controller';
import { IntegrationConnectionService } from './integration-connection.service';
import { IntegrationProviderCatalogController } from './integration-provider-catalog.controller';
import { IntegrationOAuthController } from './integration-oauth.controller';
import { IntegrationOAuthCoreService } from './integration-oauth-core.service';
import { IntegrationProviderBootstrapService } from './integration-provider-bootstrap.service';
import { IntegrationCredentialProbeRegistry } from './provider-credential-probe.registry';
import { IntegrationProviderRegistry } from './provider-registry.service';
import { IntegrationRuntimeEnvironmentService } from './runtime-environment.service';
import { IntegrationSecretDrController } from './integration-secret-dr.controller';
import { IntegrationSecretDrService } from './integration-secret-dr.service';
import { IntegrationSecretResolverService } from './secrets/integration-secret-resolver.service';
import { INTEGRATION_SECRET_VAULT } from './secrets/integration-secret-vault.port';
import { OciAuthenticationProviderFactory } from './secrets/oci/oci-authentication-provider.factory';
import { OciIntegrationSecretVaultAdapter } from './secrets/oci/oci-integration-secret-vault.adapter';
import { OciVaultClientFactory } from './secrets/oci/oci-vault-client.factory';
import { OciVaultConfigurationService } from './secrets/oci/oci-vault-configuration.service';
import { UnavailableIntegrationSecretVaultAdapter } from './secrets/unavailable-integration-secret-vault.adapter';

@Module({
  imports: [AuthModule, ProductEntitlementsModule],
  controllers: [
    IntegrationCredentialTenantController,
    IntegrationCredentialGlobalController,
    IntegrationProviderCatalogController,
    IntegrationOAuthController,
    IntegrationSecretDrController,
    IntegrationBreakGlassController,
  ],
  providers: [
    PrismaService,
    AuditService,
    IntegrationProviderRegistry,
    IntegrationProviderBootstrapService,
    IntegrationOAuthCoreService,
    IntegrationCredentialProbeRegistry,
    IntegrationConnectionService,
    IntegrationCredentialAdminService,
    IntegrationBreakGlassService,
    IntegrationSecretDrService,
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
    IntegrationOAuthCoreService,
    IntegrationConnectionService,
    IntegrationCredentialAdminService,
    IntegrationCredentialProbeRegistry,
    IntegrationBreakGlassService,
    IntegrationSecretDrService,
    IntegrationRuntimeEnvironmentService,
    IntegrationSecretResolverService,
    INTEGRATION_SECRET_VAULT,
  ],
})
export class IntegrationsModule {}
