import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IntegrationSecretValue } from '../integrations/secrets/integration-secret-vault.port';

export interface TenantPaymentCheckoutInput {
  requestId: string;
  chargeId: string;
  studentId: string;
  amount: number;
  currency: string;
  dueDate: Date | null;
  publicConfiguration: unknown;
  credential: IntegrationSecretValue;
}

export interface TenantPaymentCheckoutResult {
  providerChargeRef: string;
  checkoutUrl: string | null;
  pixQrCode: string | null;
  expiresAt: Date | null;
}

export interface TenantPaymentProviderAdapter {
  readonly providerCode: string;
  createCheckout(
    input: TenantPaymentCheckoutInput,
  ): Promise<TenantPaymentCheckoutResult>;
}

@Injectable()
export class TenantPaymentProviderAdapterRegistry {
  private readonly adapters = new Map<string, TenantPaymentProviderAdapter>();

  private key(code: string): string {
    return code.trim().toLowerCase();
  }

  register(adapter: TenantPaymentProviderAdapter) {
    const key = this.key(adapter.providerCode);
    if (!key) {
      throw new ConflictException('Adapter de pagamento tenant sem providerCode');
    }
    if (this.adapters.has(key)) {
      throw new ConflictException(
        'Adapter de pagamento tenant duplicado para ' + adapter.providerCode,
      );
    }
    this.adapters.set(key, adapter);
  }

  require(providerCode: string): TenantPaymentProviderAdapter {
    const adapter = this.adapters.get(this.key(providerCode));
    if (!adapter) {
      throw new ServiceUnavailableException(
        'Provider de pagamento tenant ainda nao possui adapter homologado',
      );
    }
    return adapter;
  }
}
