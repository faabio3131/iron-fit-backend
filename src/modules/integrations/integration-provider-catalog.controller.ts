import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { IntegrationProviderRegistry } from './provider-registry.service';
import { IntegrationRuntimeEnvironmentService } from './runtime-environment.service';

@Controller('integrations/providers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN')
export class IntegrationProviderCatalogController {
  constructor(
    private readonly providers: IntegrationProviderRegistry,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
  ) {}

  @Get()
  list() {
    return {
      environment: this.runtime.current(),
      providers: this.providers.list().map((provider) => ({
        providerCode: provider.providerCode,
        capabilities: [...provider.capabilities],
        authModels: [...provider.authModels],
        environments: [...provider.environments],
        supportsWebhook: provider.supportsWebhook,
        supportsOAuth: provider.supportsOAuth,
        tenantEntitlementFeatureKey: provider.tenantEntitlementFeatureKey ?? null,
      })),
    };
  }
}
