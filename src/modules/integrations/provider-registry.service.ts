import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertCapability,
  assertProviderCode,
  IntegrationProviderDescriptor,
} from './contracts/integration-contract';

@Injectable()
export class IntegrationProviderRegistry {
  private readonly providers = new Map<string, Readonly<IntegrationProviderDescriptor>>();

  register(descriptor: IntegrationProviderDescriptor): Readonly<IntegrationProviderDescriptor> {
    const providerCode = assertProviderCode(descriptor.providerCode);
    if (this.providers.has(providerCode)) {
      throw new ConflictException('Integration provider ' + providerCode + ' ja registrado');
    }

    const capabilities = [...new Set(descriptor.capabilities.map(assertCapability))];
    if (capabilities.length === 0) throw new ConflictException('Integration provider exige ao menos uma capability');
    if (descriptor.authModels.length === 0) throw new ConflictException('Integration provider exige ao menos um authModel');
    if (descriptor.environments.length === 0) throw new ConflictException('Integration provider exige ao menos um environment');

    const normalized = Object.freeze({
      ...descriptor,
      providerCode,
      capabilities: Object.freeze(capabilities),
      authModels: Object.freeze([...new Set(descriptor.authModels)]),
      environments: Object.freeze([...new Set(descriptor.environments)]),
    });
    this.providers.set(providerCode, normalized);
    return normalized;
  }

  require(providerCode: string): Readonly<IntegrationProviderDescriptor> {
    const normalized = assertProviderCode(providerCode);
    const descriptor = this.providers.get(normalized);
    if (!descriptor) throw new NotFoundException('Integration provider ' + normalized + ' nao registrado');
    return descriptor;
  }

  list(): readonly Readonly<IntegrationProviderDescriptor>[] {
    return Object.freeze([...this.providers.values()]);
  }
}
