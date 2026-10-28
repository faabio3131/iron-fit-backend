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
      enabled: request.enabled,
      fallbackBehavior: request.fallbackBehavior,
      secretReference: request.secretReference,
      status: request.status,
      version: request.version,
    });
    if (!FM_SUPPORTED_PROVIDERS.has(config.providerCode) || !this.registry.has(config.providerCode)) {
      throw new ForbiddenException('AI provider not supported by FM runtime');
    }

    if (config.enabled && config.status === 'ACTIVE') {
      if (!config.secretReference) {
        throw new ForbiddenException('Active AI configuration requires FM Vault Secret Reference');
      }
      const reference = assertIntegrationSecretReference(config.secretReference);
      const connection = await this.prisma.integrationConnection.findFirst({
        where: {
          scope: IntegrationScope.GLOBAL,
          gymId: null,
          providerCode: config.providerCode,
          environment: this.runtime.current() as IntegrationEnvironment,
          status: IntegrationConnectionStatus.ACTIVE,
          secretReference: reference,
          secretVersion: { not: null },
          secretRevokedAt: null,
          OR: [{ secretExpiresAt: null }, { secretExpiresAt: { gt: new Date() } }],
        },
        select: { capabilities: true },
      });
      const needed = AI_INTEGRATION_CAPABILITY[config.capability];
      if (!connection || !Array.isArray(connection.capabilities) || !connection.capabilities.includes(needed)) {
        throw new ForbiddenException('FM AI credential not verified or capability not authorized');
      }
    }
    return this.persistence.createConfigurationProfile(config, userId);
  }
}
