import { AiHttpTransport } from '../ai/providers/ai-http-transport';
import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { IntegrationCredentialProbeRegistry, IntegrationCredentialProbeInput } from './provider-credential-probe.registry';

// Probes are deliberately called only by SUPER_ADMIN credential verification,
// after step-up. They never persist or log a provider secret.
@Injectable()
export class AiCredentialProbeBootstrapService implements OnModuleInit {
  constructor(private readonly registry: IntegrationCredentialProbeRegistry, private readonly transport: AiHttpTransport = new AiHttpTransport()) {}

  onModuleInit(): void {
    this.registry.register('openai_compatible', {
      verify: (input) => this.verifyOpenAiCompatible(input),
    });
    this.registry.register('gemini_native', {
      verify: (input) => this.verifyGemini(input),
    });
  }

  private async probe(url: string, headers: Record<string, string>): Promise<void> {
    let response: { status: number };
    try {
      response = await this.transport.get(new URL(url), headers, AbortSignal.timeout(10000));
    } catch {
      throw new ServiceUnavailableException('AI provider credential verification unavailable');
    }
    if (response.status < 200 || response.status >= 300) {
      // Never include provider error payload: it may contain confidential data.
      throw new ServiceUnavailableException('AI provider credential verification failed');
    }
  }

  private async verifyOpenAiCompatible(input: IntegrationCredentialProbeInput): Promise<void> {
    if (input.authModel !== 'API_KEY') {
      throw new ServiceUnavailableException('AI provider requires API_KEY authentication');
    }
    const family = input.publicConfiguration?.apiFamily ?? 'openai';
    if (family !== 'openai' && family !== 'nvidia') {
      throw new ServiceUnavailableException('Unsupported FM-approved API family');
    }
    const url = family === 'nvidia'
      ? 'https://integrate.api.nvidia.com/v1/models'
      : 'https://api.openai.com/v1/models';
    await this.probe(url, { Authorization: 'Bearer ' + input.secret.reveal() });
  }

  private async verifyGemini(input: IntegrationCredentialProbeInput): Promise<void> {
    if (input.authModel !== 'API_KEY') {
      throw new ServiceUnavailableException('AI provider requires API_KEY authentication');
    }
    await this.probe(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
      { 'x-goog-api-key': input.secret.reveal() },
    );
  }
}
