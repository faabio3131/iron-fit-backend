import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const OCI_VAULT_AUTH_MODES = [
  'INSTANCE_PRINCIPAL',
  'RESOURCE_PRINCIPAL',
  'CONFIG_FILE',
] as const;

export type OciVaultAuthMode = (typeof OCI_VAULT_AUTH_MODES)[number];

export interface OciVaultSettings {
  authMode: OciVaultAuthMode;
  compartmentId: string;
  vaultId: string;
  keyId: string;
  configFile?: string;
  configProfile?: string;
}

function required(config: ConfigService, name: string): string {
  const value = config.get<string>(name)?.trim();
  if (!value) throw new ServiceUnavailableException(name + ' obrigatoria para OCI Vault');
  return value;
}

function assertOcid(value: string, kind: string, name: string): string {
  if (!value.startsWith('ocid1.' + kind + '.')) {
    throw new ServiceUnavailableException(name + ' deve ser um OCID ' + kind + ' valido');
  }
  return value;
}

@Injectable()
export class OciVaultConfigurationService {
  constructor(private readonly config: ConfigService) {}

  backend(): string {
    return this.config.get<string>('INTEGRATION_SECRET_VAULT_BACKEND')?.trim().toUpperCase()
      || 'DISABLED';
  }

  isEnabled(): boolean {
    return this.backend() === 'OCI';
  }

  requireSettings(): OciVaultSettings {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('OCI Vault nao esta habilitado');
    }

    const authMode = required(this.config, 'OCI_VAULT_AUTH_MODE').toUpperCase();
    if (!OCI_VAULT_AUTH_MODES.includes(authMode as OciVaultAuthMode)) {
      throw new ServiceUnavailableException(
        'OCI_VAULT_AUTH_MODE deve ser INSTANCE_PRINCIPAL, RESOURCE_PRINCIPAL ou CONFIG_FILE',
      );
    }

    if (
      authMode === 'CONFIG_FILE'
      && this.config.get<string>('NODE_ENV')?.trim().toLowerCase() === 'production'
    ) {
      throw new ServiceUnavailableException(
        'CONFIG_FILE e proibido para OCI Vault em producao',
      );
    }

    return {
      authMode: authMode as OciVaultAuthMode,
      compartmentId: assertOcid(
        required(this.config, 'OCI_VAULT_COMPARTMENT_ID'),
        'compartment',
        'OCI_VAULT_COMPARTMENT_ID',
      ),
      vaultId: assertOcid(
        required(this.config, 'OCI_VAULT_ID'),
        'vault',
        'OCI_VAULT_ID',
      ),
      keyId: assertOcid(
        required(this.config, 'OCI_VAULT_KEY_ID'),
        'key',
        'OCI_VAULT_KEY_ID',
      ),
      configFile: this.config.get<string>('OCI_CONFIG_FILE')?.trim() || undefined,
      configProfile: this.config.get<string>('OCI_CONFIG_PROFILE')?.trim() || undefined,
    };
  }
}
