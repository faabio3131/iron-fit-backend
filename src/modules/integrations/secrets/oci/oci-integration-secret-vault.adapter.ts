import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import * as secrets from 'oci-secrets';
import * as vault from 'oci-vault';
import { assertIntegrationSecretReference } from '../../contracts/integration-contract';
import {
  IntegrationSecretVaultPort,
  VaultSecretSnapshot,
} from '../integration-secret-vault.port';
import {
  OciVaultClientFactory,
  OciVaultClients,
} from './oci-vault-client.factory';

const MAX_SECRET_BYTES = 25 * 1024;
const REVOKE_DELETE_DELAY_MS = 25 * 60 * 60 * 1000;

function assertSecretValue(value: string): Buffer {
  if (!value) throw new ConflictException('Segredo de integracao vazio');
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength > MAX_SECRET_BYTES) {
    throw new ConflictException('Segredo de integracao excede limite de 25 KB do OCI Vault');
  }
  return bytes;
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === 'number' ? value : undefined;
}

@Injectable()
export class OciIntegrationSecretVaultAdapter implements IntegrationSecretVaultPort {
  constructor(private readonly factory: OciVaultClientFactory) {}

  private async current(reference: string, clients?: OciVaultClients) {
    const safeReference = assertIntegrationSecretReference(reference);
    const active = clients ?? await this.factory.clients();
    const response = await active.secretsClient.getSecretBundleByName({
      secretName: safeReference,
      vaultId: active.settings.vaultId,
      stage: secrets.requests.GetSecretBundleByNameRequest.Stage.Current,
    });
    return response.secretBundle;
  }

  private decode(bundle: secrets.models.SecretBundle): string {
    const content = bundle.secretBundleContent?.content;
    if (!content) {
      throw new ServiceUnavailableException('OCI Vault retornou segredo sem conteudo');
    }
    return Buffer.from(content, 'base64').toString('utf8');
  }

  async putSecret(input: {
    reference: string;
    value: string;
    expectedVersion?: number;
  }): Promise<{ version: number; expiresAt?: Date | null }> {
    const reference = assertIntegrationSecretReference(input.reference);
    const bytes = assertSecretValue(input.value);
    const clients = await this.factory.clients();

    if (input.expectedVersion === undefined) {
      try {
        const response = await clients.vaultsClient.createSecret({
          createSecretDetails: {
            compartmentId: clients.settings.compartmentId,
            keyId: clients.settings.keyId,
            secretName: reference,
            vaultId: clients.settings.vaultId,
            description: 'IRON Integration Secret Vault managed secret',
            freeformTags: {
              'managed-by': 'iron-fit',
              'secret-contract': 'integration-secret-vault',
            },
            enableAutoGeneration: false,
            secretContent: {
              contentType: 'BASE64',
              content: bytes.toString('base64'),
              stage: vault.models.SecretContentDetails.Stage.Current,
            } as vault.models.Base64SecretContentDetails,
          },
          opcRetryToken: reference,
        });

        const version = response.secret.currentVersionNumber;
        if (!version) {
          const current = await this.current(reference, clients);
          return {
            version: current.versionNumber,
            expiresAt: current.timeOfExpiry ?? null,
          };
        }
        return {
          version,
          expiresAt: response.secret.timeOfCurrentVersionExpiry ?? null,
        };
      } catch (error) {
        if (statusCode(error) !== 409) {
          throw new ServiceUnavailableException('Falha ao criar segredo no OCI Vault');
        }
        const current = await this.current(reference, clients);
        const existing = this.decode(current);
        if (!sameSecret(existing, input.value)) {
          throw new ConflictException('secretReference ja existe com outro conteudo');
        }
        return {
          version: current.versionNumber,
          expiresAt: current.timeOfExpiry ?? null,
        };
      }
    }

    const current = await this.current(reference, clients);
    if (current.versionNumber !== input.expectedVersion) {
      throw new ConflictException('Versao esperada do segredo diverge do OCI Vault');
    }

    let response: vault.responses.UpdateSecretResponse;
    try {
      response = await clients.vaultsClient.updateSecret({
        secretId: current.secretId,
        updateSecretDetails: {
          secretContent: {
            contentType: 'BASE64',
            content: bytes.toString('base64'),
            stage: vault.models.SecretContentDetails.Stage.Current,
          } as vault.models.Base64SecretContentDetails,
        },
      });
    } catch {
      throw new ServiceUnavailableException('Falha ao rotacionar segredo no OCI Vault');
    }

    const version = response.secret.currentVersionNumber;
    if (!version || version <= input.expectedVersion) {
      const refreshed = await this.current(reference, clients);
      if (refreshed.versionNumber <= input.expectedVersion) {
        throw new ServiceUnavailableException(
          'OCI Vault nao confirmou nova versao do segredo',
        );
      }
      return {
        version: refreshed.versionNumber,
        expiresAt: refreshed.timeOfExpiry ?? null,
      };
    }

    return {
      version,
      expiresAt: response.secret.timeOfCurrentVersionExpiry ?? null,
    };
  }

  async getSecret(reference: string): Promise<VaultSecretSnapshot> {
    try {
      const bundle = await this.current(reference);
      return {
        value: this.decode(bundle),
        version: bundle.versionNumber,
        expiresAt: bundle.timeOfExpiry ?? null,
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Falha ao resolver segredo no OCI Vault');
    }
  }

  async revokeSecret(reference: string): Promise<void> {
    const clients = await this.factory.clients();
    let bundle: secrets.models.SecretBundle;
    try {
      bundle = await this.current(reference, clients);
    } catch {
      throw new ServiceUnavailableException('Falha ao localizar segredo para revogacao');
    }

    try {
      await clients.vaultsClient.scheduleSecretDeletion({
        secretId: bundle.secretId,
        scheduleSecretDeletionDetails: {
          timeOfDeletion: new Date(Date.now() + REVOKE_DELETE_DELAY_MS),
        },
      });
    } catch {
      throw new ServiceUnavailableException('Falha ao revogar segredo no OCI Vault');
    }
  }
}
