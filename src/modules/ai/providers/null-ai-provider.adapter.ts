import { Injectable } from '@nestjs/common';
import {
  AiExternalConfigurationContract,
  AiNormalizedRequest,
  AiNormalizedResponse,
  AiProviderAdapter,
} from '../contracts/ai-contract';

@Injectable()
export class NullAiProviderAdapter implements AiProviderAdapter {
  readonly providerCode = 'null_provider';

  async execute<TInput = unknown, TOutput = unknown>(
    request: AiNormalizedRequest<TInput>,
    configuration: Readonly<AiExternalConfigurationContract>,
  ): Promise<AiNormalizedResponse<TOutput>> {
    void request;
    void configuration;
    return {
      status: 'UNAVAILABLE',
      flags: ['AI_PROVIDER_UNAVAILABLE', 'NULL_PROVIDER'],
      failureCategory: 'UNAVAILABLE',
    };
  }
}
