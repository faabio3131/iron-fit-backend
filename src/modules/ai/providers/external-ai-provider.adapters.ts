import { Injectable } from '@nestjs/common';
import { AiProviderAdapter, AiNormalizedRequest, AiNormalizedResponse, AiExternalConfigurationContract, AiProviderRuntimeContext } from '../contracts/ai-contract';
import { AiHttpTransport, AiHttpResponseError } from './ai-http-transport';
import { aiEndpoint, aiSystemPrompt, AI_MAX_INPUT_BYTES, AI_MAX_RESPONSE_BYTES } from './ai-provider-security';

function parseText(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > AI_MAX_RESPONSE_BYTES) throw new Error('AI_OUTPUT_INVALID');
  const decoded: unknown = JSON.parse(value);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('AI_OUTPUT_INVALID');
  // Bound recursion before canonical domain validation; reject prototype and authority payloads.
  function inspect(item: unknown, depth: number) {
    if (depth > 20) throw new Error('AI_OUTPUT_DEPTH');
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('AI_OUTPUT_KEY');
        inspect(child, depth + 1);
      }
    }
  }
  inspect(decoded, 0);
  return decoded as Record<string, unknown>;
}
function failure<T>(category: AiNormalizedResponse<T>['failureCategory'], flag: string): AiNormalizedResponse<T> {
  return { status: 'FAILED', failureCategory: category, flags: [flag] };
}
function tokenCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 2147483647 ? value as number : undefined;
}

abstract class ExternalAiAdapter implements AiProviderAdapter {
  abstract readonly providerCode: string;
  readonly requiresCredential = true;
  constructor(protected readonly transport: AiHttpTransport) {}

  async execute<TInput = unknown, TOutput = unknown>(request: AiNormalizedRequest<TInput>, config: Readonly<AiExternalConfigurationContract>, runtime?: Readonly<AiProviderRuntimeContext>): Promise<AiNormalizedResponse<TOutput>> {
    if (!runtime?.credential) return { status: 'UNAVAILABLE', flags: ['AI_SECRET_UNAVAILABLE'], failureCategory: 'BAD_CREDENTIALS' };
    if (config.providerCode !== this.providerCode || !config.enabled || config.status !== 'ACTIVE'
      || request.capability !== config.capability || (config.scope === 'TENANT' && config.tenantId !== request.context.tenantId)) {
      return failure('POLICY_DENIED', 'AI_CONFIGURATION_BINDING_DENIED');
    }
    const endpoint = aiEndpoint(config);
    const input = JSON.stringify({ prompt: request.prompt, capability: request.capability, input: request.input });
    if (Buffer.byteLength(input) > AI_MAX_INPUT_BYTES) return failure('POLICY_DENIED', 'AI_INPUT_TOO_LARGE');
    const system = aiSystemPrompt(request.capability);
    const maxTokens = config.maxOutputTokens ?? 1024;
    const gemini = this.providerCode === 'gemini_native';
    const payload = gemini ? {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: input }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens },
    } : {
      model: config.modelCode,
      messages: [{ role: 'system', content: system }, { role: 'user', content: input }],
      response_format: { type: 'json_object' },
      ...(endpoint.hostname === 'integrate.api.nvidia.com' ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens }),
    };
    const key = runtime.credential.reveal();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (gemini) headers['x-goog-api-key'] = key;
    else headers.Authorization = 'Bearer ' + key;
    const signal = runtime.signal
      ? AbortSignal.any([runtime.signal, AbortSignal.timeout(config.timeoutMs)])
      : AbortSignal.timeout(config.timeoutMs);
    try {
      const response = await this.transport.post(endpoint, headers, JSON.stringify(payload), signal);
      if (response.status < 200 || response.status >= 300) {
        const category = [401, 403].includes(response.status) ? 'BAD_CREDENTIALS'
          : response.status === 429 ? 'RATE_LIMIT' : response.status >= 500 ? 'PROVIDER_INTERNAL_ERROR' : 'INVALID_RESPONSE';
        return failure(category, 'AI_UPSTREAM_ERROR');
      }
      try {
        if (Buffer.byteLength(response.body) > AI_MAX_RESPONSE_BYTES) throw new Error('AI_OUTPUT_INVALID');
        const data = JSON.parse(response.body);
        const item = gemini ? data?.candidates?.[0] : data?.choices?.[0];
        const finish = gemini ? item?.finishReason : item?.finish_reason;
        if (finish && finish !== (gemini ? 'STOP' : 'stop')) throw new Error('AI_OUTPUT_INCOMPLETE');
        if (item?.message?.refusal || item?.message?.tool_calls) throw new Error('AI_OUTPUT_REFUSED');
        const text = gemini ? item?.content?.parts?.filter((part: any) => !part.thought).map((part: any) => part.text ?? '').join('') : item?.message?.content;
        const output = parseText(text);
        // Reject secret echo without returning, logging or persisting it.
        if (key && JSON.stringify(output).includes(key)) return failure('INVALID_RESPONSE', 'AI_SECRET_ECHO_REJECTED');
        const usage = gemini ? data?.usageMetadata : data?.usage;
        return {
          status: 'SUCCEEDED', output: output as TOutput, flags: [],
          usage: { inputTokens: tokenCount(gemini ? usage?.promptTokenCount : usage?.prompt_tokens),
            outputTokens: tokenCount(gemini ? usage?.candidatesTokenCount : usage?.completion_tokens) },
        };
      } catch { return failure('INVALID_RESPONSE', 'AI_UPSTREAM_INVALID_RESPONSE'); }
    } catch (error) {
      if (error instanceof AiHttpResponseError) return failure('INVALID_RESPONSE', 'AI_UPSTREAM_INVALID_RESPONSE');
      return failure(signal.aborted ? 'TIMEOUT' : 'OFFLINE', signal.aborted ? 'AI_PROVIDER_TIMEOUT' : 'AI_TRANSPORT_UNAVAILABLE');
    }
  }
}

@Injectable()
export class OpenAiCompatibleProviderAdapter extends ExternalAiAdapter {
  readonly providerCode = 'openai_compatible';
  constructor(transport: AiHttpTransport = new AiHttpTransport()) { super(transport); }
}
@Injectable()
export class GeminiNativeProviderAdapter extends ExternalAiAdapter {
  readonly providerCode = 'gemini_native';
  constructor(transport: AiHttpTransport = new AiHttpTransport()) { super(transport); }
}
