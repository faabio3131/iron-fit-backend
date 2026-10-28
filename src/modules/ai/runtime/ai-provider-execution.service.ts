import { Injectable } from '@nestjs/common';
import {
  AiNormalizedRequest,
  AiNormalizedResponse,
} from '../contracts/ai-contract';
import { AiConfigurationResolverService } from '../configuration/ai-configuration-resolver.service';
import { AiProviderRegistryService } from '../providers/ai-provider-registry.service';
import { AiSecretReferenceService } from '../secrets/ai-secret-reference.service';
import { IntegrationSecretValue } from '../../integrations/secrets/integration-secret-vault.port';

@Injectable()
export class AiProviderExecutionService {
  constructor(
    private readonly configurations: AiConfigurationResolverService,
    private readonly providers: AiProviderRegistryService,
    private readonly secrets: AiSecretReferenceService,
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

    const provider = this.providers.resolve(
      resolution.configuration.providerCode,
    );
    if (provider.providerCode === 'null_provider') {
      return provider.execute<TInput, TOutput>(
        request,
        resolution.configuration,
        {
          connectionId: null,
          credential: null,
        },
      );
    }

    let runtime = {
      connectionId: null as string | null,
      credential: null as IntegrationSecretValue | null,
    };

    if (
      provider.requiresCredential === true ||
      resolution.configuration.secretReference
    ) {
      let secretResolution;
      try {
        secretResolution = await this.secrets.resolveForExecution(
          resolution.configuration,
          request.context.tenantId,
        );
      } catch {
        return {
          status: 'UNAVAILABLE',
          flags: ['AI_SECRET_RESOLUTION_FAILED'],
          failureCategory: 'BAD_CREDENTIALS',
        };
      }

      if (!secretResolution.available || !secretResolution.credential) {
        return {
          status: 'UNAVAILABLE',
          flags: [
            'AI_SECRET_UNAVAILABLE',
            secretResolution.reason ?? 'AI_SECRET_UNKNOWN',
          ],
          failureCategory:
            provider.requiresCredential === true
              ? 'BAD_CREDENTIALS'
              : 'CONFIGURATION_UNAVAILABLE',
        };
      }

      runtime = {
        connectionId: secretResolution.connectionId,
        credential: secretResolution.credential,
      };
    }

    const cancellation = new AbortController();
    try {
      return await this.withTimeout(
        provider.execute<TInput, TOutput>(
          request,
          resolution.configuration,
          { ...runtime, signal: cancellation.signal },
        ),
        resolution.configuration.timeoutMs,
        () => cancellation.abort(),
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

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, abort: () => void): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort();
        reject(new AiProviderTimeoutError());
      }, timeoutMs);
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
