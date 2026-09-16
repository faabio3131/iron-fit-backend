import { Injectable } from '@nestjs/common';
import { AiConfigurationScope, AiConfigurationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AiCapability,
  AiExternalConfigurationContract,
  defineAiExternalConfiguration,
} from '../contracts/ai-contract';

export interface AiConfigurationResolution {
  available: boolean;
  source: 'TENANT' | 'GLOBAL' | 'NONE';
  profileId?: string;
  configuration?: Readonly<AiExternalConfigurationContract>;
  failureCategory?: 'CONFIGURATION_UNAVAILABLE';
  flags: readonly string[];
}

@Injectable()
export class AiConfigurationResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(tenantId: string, capability: AiCapability): Promise<AiConfigurationResolution> {
    const tenantProfile = await this.prisma.aiConfigurationProfile.findFirst({
      where: {
        scope: AiConfigurationScope.TENANT,
        gymId: tenantId,
        capability,
      },
      orderBy: { version: 'desc' },
    });

    if (tenantProfile) {
      return this.toResolution(tenantProfile, 'TENANT');
    }

    const globalProfile = await this.prisma.aiConfigurationProfile.findFirst({
      where: {
        scope: AiConfigurationScope.GLOBAL,
        gymId: null,
        capability,
      },
      orderBy: { version: 'desc' },
    });

    if (globalProfile) {
      return this.toResolution(globalProfile, 'GLOBAL');
    }

    return {
      available: false,
      source: 'NONE',
      failureCategory: 'CONFIGURATION_UNAVAILABLE',
      flags: ['AI_CONFIGURATION_NOT_FOUND'],
    };
  }

  private toResolution(
    profile: {
      id: string;
      scope: AiConfigurationScope;
      gymId: string | null;
      capability: string;
      providerCode: string;
      modelCode: string;
      endpoint: string | null;
      region: string | null;
      timeoutMs: number;
      budgetUnits: number | null;
      enabled: boolean;
      fallbackBehavior: 'FAIL_CLOSED' | 'ADVISORY_FALLBACK';
      secretReference: string | null;
      status: AiConfigurationStatus;
      version: number;
    },
    source: 'TENANT' | 'GLOBAL',
  ): AiConfigurationResolution {
    if (!profile.enabled || profile.status !== AiConfigurationStatus.ACTIVE) {
      return {
        available: false,
        source,
        profileId: profile.id,
        failureCategory: 'CONFIGURATION_UNAVAILABLE',
        flags: ['AI_CONFIGURATION_DISABLED'],
      };
    }

    const configuration = defineAiExternalConfiguration({
      scope: profile.scope,
      tenantId: profile.gymId ?? undefined,
      capability: profile.capability as AiCapability,
      providerCode: profile.providerCode,
      modelCode: profile.modelCode,
      endpoint: profile.endpoint ?? undefined,
      region: profile.region ?? undefined,
      timeoutMs: profile.timeoutMs,
      budgetUnits: profile.budgetUnits ?? undefined,
      enabled: profile.enabled,
      fallbackBehavior: profile.fallbackBehavior,
      secretReference: profile.secretReference ?? undefined,
      status: profile.status,
      version: profile.version,
    });

    return {
      available: true,
      source,
      profileId: profile.id,
      configuration,
      flags: [],
    };
  }
}
