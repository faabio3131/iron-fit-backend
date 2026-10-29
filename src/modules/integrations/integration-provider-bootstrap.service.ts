import { Injectable, OnModuleInit } from '@nestjs/common';
import { IntegrationProviderRegistry } from './provider-registry.service';

@Injectable()
export class IntegrationProviderBootstrapService implements OnModuleInit {
  constructor(
    private readonly providers: IntegrationProviderRegistry,
  ) {}

  onModuleInit() {

    // FM-owned AI integrations. Deliberately no tenant entitlement for credential
    // creation: tenants consume AI capabilities, never supply AI API secrets.
    for (const providerCode of ['openai_compatible', 'gemini_native']) {
      this.providers.register({
        providerCode,
        capabilities: [
          'ai.workout_insights',
          'ai.advisory_chat',
          'ai.workout_generation',
          'ai.content_recommendation',
        ],
        authModels: ['API_KEY'],
        environments: ['DEV', 'HOMOLOG', 'PROD'],
        supportsWebhook: false,
        supportsOAuth: false,
      });
    }

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
      providerCode: 'evolution',
      capabilities: ['evolution.whatsapp'],
      authModels: ['API_KEY'],
      environments: ['DEV', 'HOMOLOG', 'PROD'],
      supportsWebhook: true,
      supportsOAuth: false,
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

    this.providers.register({
      providerCode: 'fm-fiscal-core',
      capabilities: ['fiscal.bridge'],
      authModels: ['ACCESS_TOKEN'],
      environments: ['HOMOLOG', 'PROD'],
      supportsWebhook: true,
      supportsOAuth: false,
    });
  }
}
