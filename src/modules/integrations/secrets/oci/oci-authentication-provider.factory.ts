import { Injectable } from '@nestjs/common';
import common = require('oci-common');
import { OciVaultConfigurationService } from './oci-vault-configuration.service';

@Injectable()
export class OciAuthenticationProviderFactory {
  constructor(private readonly configuration: OciVaultConfigurationService) {}

  async create(): Promise<common.AuthenticationDetailsProvider> {
    const settings = this.configuration.requireSettings();

    if (settings.authMode === 'INSTANCE_PRINCIPAL') {
      return new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
    }

    if (settings.authMode === 'RESOURCE_PRINCIPAL') {
      return common.ResourcePrincipalAuthenticationDetailsProvider.builder();
    }

    return new common.ConfigFileAuthenticationDetailsProvider(
      settings.configFile,
      settings.configProfile,
    );
  }
}
