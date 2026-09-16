import { ConflictException, Injectable } from '@nestjs/common';
import { AiProviderAdapter } from '../contracts/ai-contract';
import { NullAiProviderAdapter } from './null-ai-provider.adapter';

@Injectable()
export class AiProviderRegistryService {
  private readonly providers = new Map<string, AiProviderAdapter>();

  constructor(private readonly nullProvider: NullAiProviderAdapter) {
    this.providers.set(nullProvider.providerCode, nullProvider);
  }

  register(adapter: AiProviderAdapter) {
    if (this.providers.has(adapter.providerCode)) {
      throw new ConflictException(`Provider AI ja registrado: ${adapter.providerCode}`);
    }
    this.providers.set(adapter.providerCode, adapter);
  }

  resolve(providerCode: string): AiProviderAdapter {
    return this.providers.get(providerCode) ?? this.nullProvider;
  }

  has(providerCode: string): boolean {
    return this.providers.has(providerCode);
  }

  listProviderCodes(): readonly string[] {
    return Object.freeze(Array.from(this.providers.keys()).sort());
  }
}
