import { Injectable, OnModuleInit } from '@nestjs/common';
import { IntegrationProviderRegistry } from './provider-registry.service';

@Injectable()
export class IntegrationProviderBootstrapService implements OnModuleInit {
  constructor(
    private readonly providers: IntegrationProviderRegistry,
  ) {}

  onModuleInit() {
    this.providers.register({
      providerCode: 'meta',
      capabilities: [
        'meta.facebook',
        'meta.instagram',
        'meta.whatsapp',
      ],
      authModels: ['OAUTH2'],
      environments: ['DEV', 'HOMOLOG', 'PROD'],
      supportsWebhook: true,
      supportsOAuth: true,
      tenantEntitlementFeatureKey: 'integration.meta',
    });

    this.providers.register({
      providerCode: 'google',
      capabilities: ['google.oauth'],
      authModels: ['OAUTH2'],
      environments: ['DEV', 'HOMOLOG', 'PROD'],
      supportsWebhook: false,
      supportsOAuth: true,
      tenantEntitlementFeatureKey: 'integration.google',
    });
  }
}
