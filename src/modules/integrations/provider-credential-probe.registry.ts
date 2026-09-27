import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { assertProviderCode } from './contracts/integration-contract';
import { IntegrationSecretValue } from './secrets/integration-secret-vault.port';

export interface IntegrationCredentialProbeInput {
  providerCode: string;
  authModel: string;
  capabilities: readonly string[];
  publicConfiguration: Readonly<Record<string, unknown>> | null;
  secret: IntegrationSecretValue;
}

export interface IntegrationCredentialProbe {
  verify(input: IntegrationCredentialProbeInput): Promise<void>;
}

@Injectable()
export class IntegrationCredentialProbeRegistry {
  private readonly probes = new Map<string, IntegrationCredentialProbe>();

  register(providerCode: string, probe: IntegrationCredentialProbe): void {
    this.probes.set(assertProviderCode(providerCode), probe);
  }

  require(providerCode: string): IntegrationCredentialProbe {
    const key = assertProviderCode(providerCode);
    const probe = this.probes.get(key);
    if (!probe) {
      throw new ServiceUnavailableException(
        'Provider credential probe nao configurado para ' + key,
      );
    }
    return probe;
  }
}
