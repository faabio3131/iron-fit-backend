import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IntegrationSecretValue } from '../integrations/secrets/integration-secret-vault.port';

export class TransactionalEmailDispatchFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'TransactionalEmailDispatchFailure';
  }
}

export interface TransactionalEmailDispatchInput {
  dispatchKey: string;
  recipient: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  publicConfiguration: unknown;
  credential: IntegrationSecretValue;
}

export interface TransactionalEmailDispatchResult {
  providerMessageRef: string | null;
}

export interface TransactionalEmailProviderAdapter {
  readonly providerCode: string;
  dispatch(
    input: TransactionalEmailDispatchInput,
  ): Promise<TransactionalEmailDispatchResult>;
}

@Injectable()
export class TransactionalEmailProviderAdapterRegistry {
  private readonly adapters = new Map<
    string,
    TransactionalEmailProviderAdapter
  >();

  register(adapter: TransactionalEmailProviderAdapter) {
    const providerCode = adapter.providerCode.trim().toLowerCase();
    if (!providerCode) {
      throw new ServiceUnavailableException(
        'Provider de e-mail sem providerCode',
      );
    }
    if (this.adapters.has(providerCode)) {
      throw new ServiceUnavailableException(
        'Adapter de e-mail duplicado para ' + providerCode,
      );
    }
    this.adapters.set(providerCode, adapter);
  }

  require(providerCode: string): TransactionalEmailProviderAdapter {
    const normalized = providerCode.trim().toLowerCase();
    const adapter = this.adapters.get(normalized);
    if (!adapter) {
      throw new ServiceUnavailableException(
        'Adapter de e-mail nao implementado para ' + normalized,
      );
    }
    return adapter;
  }
}
