import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CreatorMediaProvider } from './media-provider.contract';

const PROVIDER_CODE_PATTERN = /^[a-z][a-z0-9._-]{1,63}$/;

@Injectable()
export class CreatorMediaProviderRegistry {
  private readonly providers = new Map<string, CreatorMediaProvider>();

  register(provider: CreatorMediaProvider) {
    const providerCode = provider.providerCode.trim().toLowerCase();
    if (!PROVIDER_CODE_PATTERN.test(providerCode)) {
      throw new ConflictException('Media providerCode invalido');
    }
    if (this.providers.has(providerCode)) {
      throw new ConflictException(
        `Media provider ${providerCode} ja esta registrado`,
      );
    }
    this.providers.set(providerCode, provider);
  }

  getConfigured(): CreatorMediaProvider {
    const providerCode = process.env.IRON_MEDIA_PROVIDER_CODE
      ?.trim()
      .toLowerCase();
    if (!providerCode) {
      throw new ServiceUnavailableException(
        'Media provider IRON ainda nao esta configurado/homologado',
      );
    }
    return this.getByCode(providerCode);
  }

  getByCode(providerCode: string): CreatorMediaProvider {
    const normalized = providerCode.trim().toLowerCase();
    const provider = this.providers.get(normalized);
    if (!provider) {
      throw new ServiceUnavailableException(
        `Media provider ${normalized} nao esta registrado/homologado`,
      );
    }
    return provider;
  }
}
