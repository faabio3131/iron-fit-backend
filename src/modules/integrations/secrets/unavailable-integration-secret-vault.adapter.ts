import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  IntegrationSecretVaultPort,
  VaultSecretSnapshot,
} from './integration-secret-vault.port';

@Injectable()
export class UnavailableIntegrationSecretVaultAdapter implements IntegrationSecretVaultPort {
  private unavailable(): never {
    throw new ServiceUnavailableException('Integration Secret Vault fisico nao configurado');
  }

  async putSecret(): Promise<{ version: number; expiresAt?: Date | null }> {
    return this.unavailable();
  }

  async getSecret(): Promise<VaultSecretSnapshot> {
    return this.unavailable();
  }

  async revokeSecret(): Promise<void> {
    return this.unavailable();
  }
}
