import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  IntegrationSecretVaultPort,
  VaultSecretMetadata,
  VaultSecretSnapshot,
} from './integration-secret-vault.port';

@Injectable()
export class UnavailableIntegrationSecretVaultAdapter implements IntegrationSecretVaultPort {
  private unavailable(): never {
    throw new ServiceUnavailableException('Integration Secret Vault fisico nao configurado');
  }

  async putSecret(_input: { reference: string; value: string; expectedVersion?: number }): Promise<{ version: number; expiresAt?: Date | null }> {
    return this.unavailable();
  }

  async getSecret(_reference: string): Promise<VaultSecretSnapshot> {
    return this.unavailable();
  }

  async inspectSecret(_reference: string): Promise<VaultSecretMetadata> {
    return this.unavailable();
  }

  async revokeSecret(_reference: string): Promise<void> {
    return this.unavailable();
  }
}
