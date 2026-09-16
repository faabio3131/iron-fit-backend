import { Injectable } from '@nestjs/common';
import {
  AiNormalizedRequest,
  AiNormalizedResponse,
} from '../contracts/ai-contract';
import { AiConfigurationResolverService } from '../configuration/ai-configuration-resolver.service';
import { AiProviderRegistryService } from '../providers/ai-provider-registry.service';

@Injectable()
export class AiProviderExecutionService {
  constructor(
    private readonly configurations: AiConfigurationResolverService,
    private readonly providers: AiProviderRegistryService,
  ) {}

  async execute<TInput = unknown, TOutput = unknown>(
    request: AiNormalizedRequest<TInput>,
  ): Promise<AiNormalizedResponse<TOutput>> {
    const resolution = await this.configurations.resolve(
      request.context.tenantId,
      request.capability,
    );

    if (!resolution.available || !resolution.configuration) {
      return {
        status: 'UNAVAILABLE',
        flags: resolution.flags,
        failureCategory: 'CONFIGURATION_UNAVAILABLE',
      };
    }

    if (resolution.configuration.budgetUnits === 0) {
      return {
        status: 'UNAVAILABLE',
        flags: ['AI_BUDGET_EXHAUSTED'],
        failureCategory: 'CONFIGURATION_UNAVAILABLE',
      };
    }

    const provider = this.providers.resolve(resolution.configuration.providerCode);
    if (provider.providerCode === 'null_provider') {
      return provider.execute<TInput, TOutput>(request, resolution.configuration);
    }

    try {
      return await this.withTimeout(
        provider.execute<TInput, TOutput>(request, resolution.configuration),
        resolution.configuration.timeoutMs,
      );
    } catch (error) {
      if (error instanceof AiProviderTimeoutError) {
        return {
          status: 'FAILED',
          flags: ['AI_PROVIDER_TIMEOUT'],
          failureCategory: 'TIMEOUT',
        };
      }
      return {
        status: 'FAILED',
        flags: ['AI_PROVIDER_EXECUTION_FAILED'],
        failureCategory: 'PROVIDER_INTERNAL_ERROR',
      };
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AiProviderTimeoutError()), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

class AiProviderTimeoutError extends Error {
  constructor() {
    super('AI provider timeout');
    this.name = 'AiProviderTimeoutError';
  }
}
