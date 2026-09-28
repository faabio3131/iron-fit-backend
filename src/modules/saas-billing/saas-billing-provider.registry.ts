import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InternalSandboxBillingAdapter } from './adapters/internal-sandbox-billing.adapter';
import { SaasBillingProviderPort } from './contracts/saas-billing-provider.port';

@Injectable()
export class SaasBillingProviderRegistry {
  private readonly adapters = new Map<string, SaasBillingProviderPort>();

  constructor(sandbox: InternalSandboxBillingAdapter) {
    this.register(sandbox);
  }

  private key(code: string): string {
    return code.trim().toLowerCase();
  }

  register(adapter: SaasBillingProviderPort) {
    const code = this.key(adapter.code);
    if (!code) {
      throw new ConflictException('Adapter de billing sem provider code');
    }
    if (this.adapters.has(code)) {
      throw new ConflictException(
        'Adapter de billing duplicado para ' + adapter.code,
      );
    }
    this.adapters.set(code, adapter);
  }

  require(code: string): SaasBillingProviderPort {
    const adapter = this.adapters.get(this.key(code));
    if (!adapter) {
      throw new ServiceUnavailableException(
        'Provider SaaS billing configurado ainda nao possui adapter homologado',
      );
    }
    return adapter;
  }
}
