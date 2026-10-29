import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { IntegrationProviderRegistry } from './provider-registry.service';
import { IntegrationRuntimeEnvironmentService } from './runtime-environment.service';

@Controller('integrations/providers')
@UseGuards(JwtAuthGuard, RolesGuard, StepUpGuard)
@Roles('OWNER', 'SUPER_ADMIN')
export class IntegrationProviderCatalogController {
  constructor(
    private readonly providers: IntegrationProviderRegistry,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
  ) {}

  @Get()
  list(@CurrentUser() user?: { roles?: string[] }) {
    // Provedores sem permissão comercial de tenant (IA, fiscal da FM) pertencem à
    // FM Tecnologia: a academia não os vê nem configura. Só SUPER_ADMIN os lista.
    const platformOperator = Array.isArray(user?.roles) && user.roles.includes('SUPER_ADMIN');
    return {
      environment: this.runtime.current(),
      providers: this.providers
        .list()
        .filter((provider) => platformOperator || !!provider.tenantEntitlementFeatureKey)
        .map((provider) => ({
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
