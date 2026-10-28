import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AiExternalConfigurationContract, AiNormalizedRequest, AiNormalizedResponse, AiProviderRuntimeContext } from '../contracts/ai-contract';
import { AiConfigurationResolverService } from '../configuration/ai-configuration-resolver.service';
import { AiProviderRegistryService } from '../providers/ai-provider-registry.service';
import { AiSecretReferenceService } from '../secrets/ai-secret-reference.service';
import { AiAttemptLedgerService } from './ai-attempt-ledger.service';

const TRANSIENT = new Set(['RATE_LIMIT', 'PROVIDER_INTERNAL_ERROR', 'OFFLINE', 'TIMEOUT']);

@Injectable()
export class AiProviderExecutionService {
  // Availability optimization only. Durable budget/idempotency remains in PostgreSQL across replicas/restarts.
  private readonly circuits = new Map<string, { failures: number; until: number }>();
  constructor(
    private readonly configurations: AiConfigurationResolverService,
    private readonly providers: AiProviderRegistryService,
    private readonly secrets: AiSecretReferenceService,
    private readonly ledger: AiAttemptLedgerService,
  ) {}

  async execute<TInput = unknown, TOutput = unknown>(request: AiNormalizedRequest<TInput>): Promise<AiNormalizedResponse<TOutput>> {
    if (!request.context?.tenantId || !request.context.requestId || request.context.requestId.length > 160) {
      return this.denied('AI_REQUEST_CONTEXT_INVALID');
    }
    const resolution = await this.configurations.resolve(request.context.tenantId, request.capability);
    if (!resolution.available || !resolution.configuration) {
      return { status: 'UNAVAILABLE', flags: resolution.flags, failureCategory: 'CONFIGURATION_UNAVAILABLE' };
    }
    const primary = resolution.configuration;
    if (!primary.enabled || primary.status !== 'ACTIVE' || primary.capability !== request.capability
      || (primary.scope === 'TENANT' && primary.tenantId !== request.context.tenantId)) return this.denied('AI_CONFIGURATION_BINDING_DENIED');
    if (primary.budgetUnits === 0) return this.denied('AI_BUDGET_EXHAUSTED');
    // Unknown provider cannot activate another route. null_provider remains an explicit fail-closed adapter.
    if (this.providers.resolve(primary.providerCode).providerCode === 'null_provider') {
      return this.providers.resolve(primary.providerCode).execute(request, primary, { connectionId: null, credential: null });
    }
    if (!resolution.profileId) return this.denied('AI_PROFILE_ID_REQUIRED');
    const routes = [primary, ...(primary.fallbackBehavior === 'ADVISORY_FALLBACK' ? primary.fallbackTargets ?? [] : [])
      .map((target) => ({ ...primary, ...target, pricing: undefined }))];
    let result: AiNormalizedResponse<TOutput> = this.denied('AI_ROUTES_UNAVAILABLE');
    let ordinal = 0;
    for (const config of routes) {
      const provider = this.providers.resolve(config.providerCode);
      if (provider.providerCode === 'null_provider') return this.denied('AI_PROVIDER_NOT_REGISTERED');
      const circuitKey = createHash('sha256').update(JSON.stringify([request.context.tenantId, resolution.profileId,
        config.providerCode, config.modelCode, config.secretReference, config.endpoint])).digest('hex');
      if ((this.circuits.get(circuitKey)?.until ?? 0) > Date.now()) {
        result = { status: 'UNAVAILABLE', failureCategory: 'UNAVAILABLE', flags: ['AI_CIRCUIT_OPEN'] };
        continue;
      }
      let runtime: AiProviderRuntimeContext = { connectionId: null, credential: null };
      if (provider.requiresCredential || config.secretReference) {
        try {
          const secret = await this.secrets.resolveForExecution(config, request.context.tenantId);
          if (!secret.available || !secret.credential) return { status: 'UNAVAILABLE', failureCategory: 'BAD_CREDENTIALS', flags: ['AI_SECRET_UNAVAILABLE'] };
          runtime = { connectionId: secret.connectionId, credential: secret.credential };
        } catch { return { status: 'UNAVAILABLE', failureCategory: 'BAD_CREDENTIALS', flags: ['AI_SECRET_RESOLUTION_FAILED'] }; }
      }
      // Only explicit throttling is retried; ambiguous timeout/5xx are not replayed on the same provider.
      // Every retry/fallback reserves another unit before it can incur external usage.
      for (let retry = 0; retry < 2; retry++) {
        let id: string | null;
        try { id = await this.ledger.reserve(resolution.profileId, request, config, ordinal++); }
        catch { return this.denied('AI_LEDGER_UNAVAILABLE'); }
        if (!id) return this.denied('AI_BUDGET_OR_REPLAY_DENIED');
        const cancellation = new AbortController();
        const startedAt = Date.now();
        let timer: NodeJS.Timeout | undefined;
        try {
          result = await Promise.race([
            provider.execute<TInput, TOutput>(request, config, { ...runtime, signal: cancellation.signal }),
            new Promise<AiNormalizedResponse<TOutput>>((resolve) => {
              timer = setTimeout(() => {
                resolve({ status: 'FAILED', flags: ['AI_PROVIDER_TIMEOUT'], failureCategory: 'TIMEOUT' });
                cancellation.abort();
              }, config.timeoutMs);
            }),
          ]);
        } catch { result = { status: 'FAILED', flags: ['AI_PROVIDER_EXECUTION_FAILED'], failureCategory: 'PROVIDER_INTERNAL_ERROR' }; }
        finally { clearTimeout(timer); }
        result = { ...result, execution: { providerCode: config.providerCode, modelCode: config.modelCode,
          profileId: resolution.profileId, scope: config.scope, version: config.version } };
        try { await this.ledger.complete(id, result, Date.now() - startedAt, config.pricing); }
        catch { return this.denied('AI_LEDGER_COMPLETION_FAILED'); }
        if (result.status === 'SUCCEEDED') { this.circuits.delete(circuitKey); return result; }
        if (!TRANSIENT.has(result.failureCategory ?? '')) return result;
        const failures = (this.circuits.get(circuitKey)?.failures ?? 0) + 1;
        if (this.circuits.size >= 1024) this.circuits.delete(this.circuits.keys().next().value!);
        this.circuits.set(circuitKey, { failures, until: failures >= 3 ? Date.now() + 30_000 : 0 });
        if (result.failureCategory !== 'RATE_LIMIT' || retry === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 100 + Math.floor(Math.random() * 100)));
      }
      if (primary.fallbackBehavior === 'FAIL_CLOSED') break;
    }
    return result;
  }

  private denied<T> (flag: string): AiNormalizedResponse<T> {
    return { status: 'UNAVAILABLE', flags: [flag], failureCategory: 'CONFIGURATION_UNAVAILABLE' };
  }
}
