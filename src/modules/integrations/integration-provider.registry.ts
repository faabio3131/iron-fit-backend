import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { IntegrationEnvironment } from '@prisma/client';

export type IntegrationAuthModel =
  | 'API_KEY'
  | 'OAUTH2'
  | 'WEBHOOK'
  | 'CERTIFICATE'
  | 'COMPOSITE';

export interface IntegrationProviderDefinition {
  providerCode: string;
  authModel: IntegrationAuthModel;
  capabilities: readonly string[];
  environments: readonly IntegrationEnvironment[];
  publicConfigurationKeys: readonly string[];
  secretKeys: readonly string[];
}

export interface IntegrationProviderPublicDefinition {
  providerCode: string;
  authModel: IntegrationAuthModel;
  capabilities: readonly string[];
  environments: readonly IntegrationEnvironment[];
  publicConfigurationKeys: readonly string[];
  requiresSecret: boolean;
}

const PROVIDER_CODE_PATTERN = /^[a-z][a-z0-9._-]{1,63}$/;
const CONFIG_KEY_PATTERN = /^[a-z][A-Za-z0-9._-]{0,63}$/;

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

@Injectable()
export class IntegrationProviderRegistry {
  private readonly providers = new Map<string, Readonly<IntegrationProviderDefinition>>();

  register(definition: IntegrationProviderDefinition) {
    const providerCode = definition.providerCode.trim().toLowerCase();
    if (!PROVIDER_CODE_PATTERN.test(providerCode)) {
      throw new ConflictException('providerCode de integracao invalido');
    }
    if (this.providers.has(providerCode)) {
      throw new ConflictException('provider de integracao duplicado');
    }

    for (const key of [
      ...definition.publicConfigurationKeys,
      ...definition.secretKeys,
    ]) {
      if (!CONFIG_KEY_PATTERN.test(key)) {
        throw new ConflictException('chave de configuracao de integracao invalida');
      }
    }

    const publicKeys = unique(definition.publicConfigurationKeys);
    const secretKeys = unique(definition.secretKeys);
    const overlap = publicKeys.find((key) => secretKeys.includes(key));
    if (overlap) {
      throw new ConflictException(
        'chave de integracao nao pode ser publica e secreta simultaneamente',
      );
    }

    const environments = [...new Set(definition.environments)];
    if (environments.length === 0) {
      throw new ConflictException('provider de integracao sem ambiente suportado');
    }

    this.providers.set(
      providerCode,
      Object.freeze({
        providerCode,
        authModel: definition.authModel,
        capabilities: Object.freeze(unique(definition.capabilities)),
        environments: Object.freeze(environments),
        publicConfigurationKeys: Object.freeze(publicKeys),
        secretKeys: Object.freeze(secretKeys),
      }),
    );
  }

  get(providerCode: string): Readonly<IntegrationProviderDefinition> {
    const normalized = providerCode.trim().toLowerCase();
    const provider = this.providers.get(normalized);
    if (!provider) {
      throw new BadRequestException('provider de integracao nao registrado');
    }
    return provider;
  }

  list(): IntegrationProviderPublicDefinition[] {
    return [...this.providers.values()]
      .sort((a, b) => a.providerCode.localeCompare(b.providerCode))
      .map((provider) => ({
        providerCode: provider.providerCode,
        authModel: provider.authModel,
        capabilities: provider.capabilities,
        environments: provider.environments,
        publicConfigurationKeys: provider.publicConfigurationKeys,
        requiresSecret: provider.secretKeys.length > 0,
      }));
  }
}
