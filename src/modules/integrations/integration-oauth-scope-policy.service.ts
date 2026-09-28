import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationEnvironment,
  IntegrationOAuthScopePolicyStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthSecurityService } from '../auth/auth-security.service';
import {
  assertCapability,
  assertProviderCode,
} from './contracts/integration-contract';
import {
  CreateOAuthScopePolicyDto,
  ReviewOAuthScopePolicyDto,
} from './dto/integration-oauth-scope-policy.dto';
import { IntegrationProviderRegistry } from './provider-registry.service';

function normalizedScopes(raw: readonly string[]): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) {
    throw new BadRequestException(
      'Politica OAuth exige entre 1 e 64 scopes',
    );
  }
  const scopes = [
    ...new Set(
      raw.map((value) => {
        if (
          typeof value !== 'string' ||
          !value.trim() ||
          value.length > 512 ||
          /\s/.test(value)
        ) {
          throw new BadRequestException('Scope OAuth invalido');
        }
        return value.trim();
      }),
    ),
  ].sort();
  if (scopes.length === 0) {
    throw new BadRequestException('Politica OAuth sem scope valido');
  }
  return scopes;
}

function jsonScopes(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new ServiceUnavailableException(
      'Politica OAuth aprovada possui scopes invalidos',
    );
  }
  if (raw.some((value) => typeof value !== 'string')) {
    throw new ServiceUnavailableException(
      'Politica OAuth aprovada possui scopes invalidos',
    );
  }
  try {
    return normalizedScopes(raw as string[]);
  } catch {
    throw new ServiceUnavailableException(
      'Politica OAuth aprovada possui scopes invalidos',
    );
  }
}

function sameScopes(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

@Injectable()
export class IntegrationOAuthScopePolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authSecurity: AuthSecurityService,
    private readonly providers: IntegrationProviderRegistry,
    private readonly audit: AuditService,
  ) {}

  private assertProviderCapability(
    providerCodeInput: string,
    environment: IntegrationEnvironment,
    capabilityInput: string,
  ) {
    const providerCode = assertProviderCode(providerCodeInput);
    const capability = assertCapability(capabilityInput);
    const provider = this.providers.require(providerCode);
    if (
      !provider.supportsOAuth ||
      !provider.authModels.includes('OAUTH2') ||
      !provider.environments.includes(environment) ||
      !provider.capabilities.includes(capability)
    ) {
      throw new BadRequestException(
        'Provider/capability nao elegivel para politica OAuth',
      );
    }
    return { providerCode, capability };
  }

  async list() {
    return this.prisma.integrationOAuthScopePolicy.findMany({
      orderBy: [
        { providerCode: 'asc' },
        { environment: 'asc' },
        { capability: 'asc' },
        { version: 'desc' },
      ],
    });
  }

  async createDraft(
    userId: string,
    dto: CreateOAuthScopePolicyDto,
  ) {
    await this.authSecurity.assertStepUp(
      userId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );

    const { providerCode, capability } = this.assertProviderCapability(
      dto.providerCode,
      dto.environment,
      dto.capability,
    );
    const scopes = normalizedScopes(dto.scopes);
    const rationale = dto.rationale?.trim() || null;

    return this.prisma.$transaction(
      async (tx) => {
        const latest = await tx.integrationOAuthScopePolicy.findFirst({
          where: {
            providerCode,
            environment: dto.environment,
            capability,
          },
          orderBy: { version: 'desc' },
        });
        const version = (latest?.version ?? 0) + 1;

        const created = await tx.integrationOAuthScopePolicy.create({
          data: {
            providerCode,
            environment: dto.environment,
            capability,
            version,
            status: IntegrationOAuthScopePolicyStatus.DRAFT,
            scopes,
            rationale,
          },
        });

        await this.audit.record(
          {
            gymId: null,
            userId,
            action: 'INTEGRATION_OAUTH_SCOPE_POLICY_DRAFTED',
            entity: 'IntegrationOAuthScopePolicy',
            entityId: created.id,
            next: {
              providerCode,
              environment: dto.environment,
              capability,
              version,
              scopes,
              rationaleConfigured: Boolean(rationale),
            },
          },
          tx,
        );

        return created;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async approve(
    policyId: string,
    userId: string,
    dto: ReviewOAuthScopePolicyDto,
  ) {
    await this.authSecurity.assertStepUp(
      userId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );

    return this.prisma.$transaction(
      async (tx) => {
        const policy = await tx.integrationOAuthScopePolicy.findUnique({
          where: { id: policyId },
        });
        if (!policy) {
          throw new NotFoundException('Politica OAuth nao encontrada');
        }
        if (policy.status !== IntegrationOAuthScopePolicyStatus.DRAFT) {
          throw new ConflictException(
            'Somente politica OAuth DRAFT pode ser aprovada',
          );
        }

        this.assertProviderCapability(
          policy.providerCode,
          policy.environment,
          policy.capability,
        );
        const scopes = jsonScopes(policy.scopes);
        const reviewedAt = new Date();

        await tx.integrationOAuthScopePolicy.updateMany({
          where: {
            providerCode: policy.providerCode,
            environment: policy.environment,
            capability: policy.capability,
            status: IntegrationOAuthScopePolicyStatus.APPROVED,
          },
          data: {
            status: IntegrationOAuthScopePolicyStatus.RETIRED,
            retiredAt: reviewedAt,
          },
        });

        const changed = await tx.integrationOAuthScopePolicy.updateMany({
          where: {
            id: policy.id,
            status: IntegrationOAuthScopePolicyStatus.DRAFT,
          },
          data: {
            status: IntegrationOAuthScopePolicyStatus.APPROVED,
            reviewedByUserId: userId,
            reviewedAt,
            retiredAt: null,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException(
            'Politica OAuth mudou durante aprovacao',
          );
        }

        await this.audit.record(
          {
            gymId: null,
            userId,
            action: 'INTEGRATION_OAUTH_SCOPE_POLICY_APPROVED',
            entity: 'IntegrationOAuthScopePolicy',
            entityId: policy.id,
            previous: {
              status: IntegrationOAuthScopePolicyStatus.DRAFT,
            },
            next: {
              status: IntegrationOAuthScopePolicyStatus.APPROVED,
              providerCode: policy.providerCode,
              environment: policy.environment,
              capability: policy.capability,
              version: policy.version,
              scopes,
              reviewedAt,
            },
          },
          tx,
        );

        return tx.integrationOAuthScopePolicy.findUnique({
          where: { id: policy.id },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async retire(
    policyId: string,
    userId: string,
    dto: ReviewOAuthScopePolicyDto,
  ) {
    await this.authSecurity.assertStepUp(
      userId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );
    const retiredAt = new Date();
    return this.prisma.$transaction(
      async (tx) => {
        const policy = await tx.integrationOAuthScopePolicy.findUnique({
          where: { id: policyId },
        });
        if (!policy) {
          throw new NotFoundException('Politica OAuth nao encontrada');
        }
        if (policy.status === IntegrationOAuthScopePolicyStatus.RETIRED) {
          return policy;
        }

        const changed = await tx.integrationOAuthScopePolicy.updateMany({
          where: {
            id: policy.id,
            status: {
              in: [
                IntegrationOAuthScopePolicyStatus.DRAFT,
                IntegrationOAuthScopePolicyStatus.APPROVED,
              ],
            },
          },
          data: {
            status: IntegrationOAuthScopePolicyStatus.RETIRED,
            retiredAt,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException(
            'Politica OAuth mudou durante retirada',
          );
        }

        await this.audit.record(
          {
            gymId: null,
            userId,
            action: 'INTEGRATION_OAUTH_SCOPE_POLICY_RETIRED',
            entity: 'IntegrationOAuthScopePolicy',
            entityId: policy.id,
            previous: { status: policy.status },
            next: {
              status: IntegrationOAuthScopePolicyStatus.RETIRED,
              retiredAt,
            },
          },
          tx,
        );

        return tx.integrationOAuthScopePolicy.findUnique({
          where: { id: policy.id },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async assertApprovedScopes(
    providerCodeInput: string,
    environment: IntegrationEnvironment,
    capabilities: readonly string[],
    configuredCapabilityScopes: Readonly<Record<string, string[]>>,
  ): Promise<string[]> {
    const providerCode = assertProviderCode(providerCodeInput);
    const uniqueCapabilities = [
      ...new Set(capabilities.map(assertCapability)),
    ].sort();

    const policies = await this.prisma.integrationOAuthScopePolicy.findMany({
      where: {
        providerCode,
        environment,
        capability: { in: uniqueCapabilities },
        status: IntegrationOAuthScopePolicyStatus.APPROVED,
      },
    });

    if (policies.length !== uniqueCapabilities.length) {
      throw new ServiceUnavailableException(
        'OAuth bloqueado: capability sem politica de scopes APPROVED',
      );
    }

    const allScopes = new Set<string>();
    for (const capability of uniqueCapabilities) {
      const matches = policies.filter(
        (policy) => policy.capability === capability,
      );
      if (matches.length !== 1) {
        throw new ServiceUnavailableException(
          'OAuth bloqueado: autoridade de scope ambigua',
        );
      }
      const approved = jsonScopes(matches[0].scopes);
      const configuredRaw = configuredCapabilityScopes[capability];
      if (!configuredRaw?.length) {
        throw new ServiceUnavailableException(
          'OAuth App global sem scopes configurados para ' + capability,
        );
      }
      let configured: string[];
      try {
        configured = normalizedScopes(configuredRaw);
      } catch {
        throw new ServiceUnavailableException(
          'OAuth App global possui scopes invalidos para ' + capability,
        );
      }
      if (!sameScopes(approved, configured)) {
        throw new ServiceUnavailableException(
          'OAuth scopes configurados divergem da politica APPROVED para ' +
            capability,
        );
      }
      approved.forEach((scope) => allScopes.add(scope));
    }

    return [...allScopes].sort();
  }
}
