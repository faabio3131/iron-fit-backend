import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as secrets from 'oci-secrets';
import * as vault from 'oci-vault';
import { OciAuthenticationProviderFactory } from './oci-authentication-provider.factory';
import {
  OciVaultConfigurationService,
  OciVaultSettings,
} from './oci-vault-configuration.service';

export interface OciVaultClients {
  settings: OciVaultSettings;
  secretsClient: secrets.SecretsClient;
  vaultsClient: vault.VaultsClient;
}

@Injectable()
export class OciVaultClientFactory implements OnModuleDestroy {
  private clientsPromise?: Promise<OciVaultClients>;

  constructor(
    private readonly authentication: OciAuthenticationProviderFactory,
    private readonly configuration: OciVaultConfigurationService,
  ) {}

  clients(): Promise<OciVaultClients> {
    if (!this.clientsPromise) {
      this.clientsPromise = this.createClients();
    }
    return this.clientsPromise;
  }

  private async createClients(): Promise<OciVaultClients> {
    const settings = this.configuration.requireSettings();
    const provider = await this.authentication.create();
    return {
      settings,
      secretsClient: new secrets.SecretsClient({
        authenticationDetailsProvider: provider,
      }),
      vaultsClient: new vault.VaultsClient({
        authenticationDetailsProvider: provider,
      }),
    };
  }

  async onModuleDestroy() {
    if (!this.clientsPromise) return;
    try {
      const clients = await this.clientsPromise;
      clients.secretsClient.close();
      clients.vaultsClient.close();
    } catch {
      // Fail-closed runtime initialization errors require no cleanup.
    }
  }
}
