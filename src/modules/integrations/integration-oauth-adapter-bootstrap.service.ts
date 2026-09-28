import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  GoogleOAuthProviderAdapter,
  IntegrationOAuthProviderAdapterRegistry,
  MetaOAuthProviderAdapter,
} from './integration-oauth-provider.adapter';

@Injectable()
export class IntegrationOAuthAdapterBootstrapService implements OnModuleInit {
  constructor(
    private readonly registry: IntegrationOAuthProviderAdapterRegistry,
    private readonly meta: MetaOAuthProviderAdapter,
    private readonly google: GoogleOAuthProviderAdapter,
  ) {}

  onModuleInit() {
    this.registry.register(this.meta);
    this.registry.register(this.google);
  }
}
