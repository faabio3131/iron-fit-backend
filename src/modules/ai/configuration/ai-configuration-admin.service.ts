import { aiEndpoint } from '../providers/ai-provider-security';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { IntegrationConnectionStatus, IntegrationEnvironment, IntegrationScope } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthSecurityService } from '../../auth/auth-security.service';
import { IntegrationRuntimeEnvironmentService } from '../../integrations/runtime-environment.service';
import { assertIntegrationSecretReference } from '../../integrations/contracts/integration-contract';
import { AiExternalConfigurationContract, defineAiExternalConfiguration } from '../contracts/ai-contract';
import { AiPersistenceService } from '../ai-persistence.service';
import { AiProviderRegistryService } from '../providers/ai-provider-registry.service';

const FM_SUPPORTED_PROVIDERS = new Set(['openai_compatible', 'gemini_native']);
const AI_INTEGRATION_CAPABILITY: Record<string, string> = {
  WORKOUT_INSIGHTS: 'ai.workout_insights',
  ADVISORY_CHAT: 'ai.advisory_chat',
  WORKOUT_GENERATION: 'ai.workout_generation',
  CONTENT_RECOMMENDATION: 'ai.content_recommendation',
};

export interface AiManagedConfigurationRequest extends AiExternalConfigurationContract {
  currentPassword: string;
  mfaCode?: string;
  recoveryCode?: string;
}

@Injectable()
export class AiConfigurationAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthSecurityService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly registry: AiProviderRegistryService,
    private readonly persistence: AiPersistenceService,
  ) {}

  async create(userId: string, request: AiManagedConfigurationRequest) {
    await this.auth.assertStepUp(userId, request.currentPassword, request.mfaCode, request.recoveryCode);
    const config = defineAiExternalConfiguration({
      scope: request.scope,
      tenantId: request.tenantId,
      capability: request.capability,
      providerCode: request.providerCode,
      modelCode: request.modelCode,
      endpoint: request.endpoint,
      region: request.region,
      timeoutMs: request.timeoutMs,
      budgetUnits: request.budgetUnits,
      maxOutputTokens: request.maxOutputTokens,
      pricing: request.pricing,
      fallbackTargets: request.fallbackTargets,
      enabled: request.enabled,
      fallbackBehavior: request.fallbackBehavior,
      secretReference: request.secretReference,
      status: request.status,
      version: request.version,
    });
    const seenTargets = new Set<string>();
    for (const target of [config, ...(config.fallbackTargets ?? []).map((target) => ({ ...config, ...target }))]) {
      if (!FM_SUPPORTED_PROVIDERS.has(target.providerCode) || !this.registry.has(target.providerCode)) {
        throw new ForbiddenException('AI provider not supported by FM runtime');
      }
      const endpoint = aiEndpoint(target);
      const key = [target.providerCode, target.modelCode, endpoint.href].join('|');
      if (seenTargets.has(key)) throw new ForbiddenException('Duplicate AI fallback target');
      seenTargets.add(key);
      if (config.enabled && config.status === 'ACTIVE') {
        if (config.budgetUnits === undefined) throw new ForbiddenException('Active AI profile requires an explicit attempt budget');
        if (!target.secretReference) throw new ForbiddenException('Active AI configuration requires FM Vault Secret Reference');
        const reference = assertIntegrationSecretReference(target.secretReference);
        const connections = await this.prisma.integrationConnection.findMany({
          where: {
            scope: IntegrationScope.GLOBAL, gymId: null, providerCode: target.providerCode,
            environment: this.runtime.current() as IntegrationEnvironment,
            status: IntegrationConnectionStatus.ACTIVE, secretReference: reference,
            secretVersion: { not: null }, secretRevokedAt: null,
            OR: [{ secretExpiresAt: null }, { secretExpiresAt: { gt: new Date() } }],
          },
          select: { capabilities: true, publicConfiguration: true },
        });
        const needed = AI_INTEGRATION_CAPABILITY[config.capability];
        if (connections.length !== 1 || !Array.isArray(connections[0].capabilities) || !connections[0].capabilities.includes(needed)) {
          throw new ForbiddenException('FM AI credential not verified or capability not authorized');
        }
        if (target.providerCode === 'openai_compatible') {
          const publicConfig = connections[0].publicConfiguration as Record<string, unknown> | null;
          const family = publicConfig?.apiFamily ?? 'openai';
          if (family !== (endpoint.hostname === 'api.openai.com' ? 'openai' : 'nvidia')) {
            throw new ForbiddenException('FM AI credential destination mismatch');
          }
        }
      }
    }
    return this.persistence.createConfigurationProfile(config, userId);
  }
}
