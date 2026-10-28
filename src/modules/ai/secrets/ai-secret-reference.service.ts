import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationRuntimeEnvironmentService } from '../../integrations/runtime-environment.service';
import { IntegrationSecretResolverService } from '../../integrations/secrets/integration-secret-resolver.service';
import { IntegrationSecretValue } from '../../integrations/secrets/integration-secret-vault.port';
import {
  AiCapability,
  AiExternalConfigurationContract,
} from '../contracts/ai-contract';
import { aiEndpoint } from '../providers/ai-provider-security';
import { assertIntegrationSecretReference } from '../../integrations/contracts/integration-contract';

const AI_INTEGRATION_CAPABILITY: Record<AiCapability, string> = {
  WORKOUT_INSIGHTS: 'ai.workout_insights',
  ADVISORY_CHAT: 'ai.advisory_chat',
  WORKOUT_GENERATION: 'ai.workout_generation',
  CONTENT_RECOMMENDATION: 'ai.content_recommendation',
};

export interface AiSecretResolution {
  available: boolean;
  connectionId: string | null;
  credential: IntegrationSecretValue | null;
  reason?:
    | 'SECRET_REFERENCE_NOT_CONFIGURED'
    | 'SECRET_CONNECTION_NOT_FOUND'
    | 'SECRET_CONNECTION_AMBIGUOUS';
}

@Injectable()
export class AiSecretReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly secrets: IntegrationSecretResolverService,
  ) {}

  async resolveForExecution(
    configuration: Readonly<AiExternalConfigurationContract>,
    tenantId: string,
  ): Promise<AiSecretResolution> {
    if (!configuration.secretReference) {
      return {
        available: false,
        connectionId: null,
        credential: null,
        reason: 'SECRET_REFERENCE_NOT_CONFIGURED',
      };
    }

    const reference = assertIntegrationSecretReference(
      configuration.secretReference,
    );
    const environment =
      this.runtime.current() as IntegrationEnvironment;
    const expectedCapability =
      AI_INTEGRATION_CAPABILITY[configuration.capability];

    // FM-owned providers always resolve a GLOBAL Vault connection, even when
    // the model/profile is selected per tenant. Academy users never own AI keys.
    const fmManaged = ['openai_compatible', 'gemini_native'].includes(configuration.providerCode);
    const scope =
      !fmManaged && configuration.scope === 'TENANT'
        ? {
            scope: IntegrationScope.TENANT,
            gymId: tenantId,
          }
        : {
            scope: IntegrationScope.GLOBAL,
            gymId: null,
          };

    if (
      configuration.scope === 'TENANT' &&
      configuration.tenantId !== tenantId
    ) {
      throw new ServiceUnavailableException(
        'AI tenant configuration diverge do tenant autenticado',
      );
    }

    const rows = await this.prisma.integrationConnection.findMany({
      where: {
        scope: scope.scope,
        gymId: scope.gymId,
        environment,
        providerCode: configuration.providerCode,
        status: IntegrationConnectionStatus.ACTIVE,
        secretReference: reference,
        secretVersion: { not: null },
        secretRevokedAt: null,
        OR: [
          { secretExpiresAt: null },
          { secretExpiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });

    const capable = rows.filter(
      (row) =>
        Array.isArray(row.capabilities) &&
        row.capabilities.some(
          (capability) =>
            typeof capability === 'string' &&
            capability.trim().toLowerCase() ===
              expectedCapability,
        ),
    );

    if (capable.length === 0) {
      return {
        available: false,
        connectionId: null,
        credential: null,
        reason: 'SECRET_CONNECTION_NOT_FOUND',
      };
    }
    if (capable.length !== 1) {
      return {
        available: false,
        connectionId: null,
        credential: null,
        reason: 'SECRET_CONNECTION_AMBIGUOUS',
      };
    }

    const connection = capable[0];
    if (fmManaged) {
      const endpoint = aiEndpoint(configuration);
      if (configuration.providerCode === 'openai_compatible') {
        const publicConfig = connection.publicConfiguration as Record<string, unknown> | null;
        const family = publicConfig?.apiFamily ?? 'openai';
        if (family !== (endpoint.hostname === 'api.openai.com' ? 'openai' : 'nvidia')) {
          throw new ServiceUnavailableException('AI credential destination mismatch');
        }
      }
    }
    const credential =
      await this.secrets.resolveForExternalBoundary(
        connection.id,
        !fmManaged && configuration.scope === 'TENANT'
          ? { scope: 'TENANT', gymId: tenantId }
          : { scope: 'GLOBAL' },
      );

    return {
      available: true,
      connectionId: connection.id,
      credential,
    };
  }
}
