import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthSecurityService } from '../auth/auth-security.service';
import {
  assertCapability,
  assertIntegrationScope,
  assertPublicIntegrationConfiguration,
  assertProviderCode,
  IntegrationConnectionScope,
  newIntegrationSecretReference,
} from './contracts/integration-contract';
import {
  CreateIntegrationCredentialDto,
  RotateIntegrationCredentialDto,
} from './dto/integration-credential-admin.dto';
import { IntegrationProviderRegistry } from './provider-registry.service';
import { IntegrationRuntimeEnvironmentService } from './runtime-environment.service';
import {
  INTEGRATION_SECRET_VAULT,
  IntegrationSecretVaultPort,
} from './secrets/integration-secret-vault.port';

interface StepUpInput {
  currentPassword: string;
  mfaCode?: string;
  recoveryCode?: string;
}

export interface IntegrationCredentialSafeView {
  id: string;
  scope: IntegrationScope;
  gymId: string | null;
  providerCode: string;
  environment: IntegrationEnvironment;
  authModel: string;
  status: IntegrationConnectionStatus;
  capabilities: unknown;
  publicConfiguration: unknown;
  credentialConfigured: boolean;
  secretVersion: number | null;
  secretRotatedAt: Date | null;
  secretExpiresAt: Date | null;
  secretLastUsedAt: Date | null;
  secretRevokedAt: Date | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function safeView(connection: any): IntegrationCredentialSafeView {
  return {
    id: connection.id,
    scope: connection.scope,
    gymId: connection.gymId ?? null,
    providerCode: connection.providerCode,
    environment: connection.environment,
    authModel: connection.authModel,
    status: connection.status,
    capabilities: connection.capabilities,
    publicConfiguration: connection.publicConfiguration ?? null,
    credentialConfigured: Boolean(
      connection.secretVersion &&
      connection.secretRotatedAt &&
      !connection.secretRevokedAt,
    ),
    secretVersion: connection.secretVersion ?? null,
    secretRotatedAt: connection.secretRotatedAt ?? null,
    secretExpiresAt: connection.secretExpiresAt ?? null,
    secretLastUsedAt: connection.secretLastUsedAt ?? null,
    secretRevokedAt: connection.secretRevokedAt ?? null,
    lastVerifiedAt: connection.lastVerifiedAt ?? null,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

@Injectable()
export class IntegrationCredentialAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authSecurity: AuthSecurityService,
    private readonly providers: IntegrationProviderRegistry,
    private readonly runtimeEnvironment: IntegrationRuntimeEnvironmentService,
    private readonly audit: AuditService,
    @Inject(INTEGRATION_SECRET_VAULT)
    private readonly vault: IntegrationSecretVaultPort,
  ) {}

  private async stepUp(userId: string, input: StepUpInput) {
    await this.authSecurity.assertStepUp(
      userId,
      input.currentPassword,
      input.mfaCode,
      input.recoveryCode,
    );
  }

  private async requireActiveRuntimeEnvironment(
    requested: string,
  ): Promise<IntegrationEnvironment> {
    const runtime = this.runtimeEnvironment.current();
    if (requested !== runtime) {
      throw new BadRequestException(
        'Integracao so pode ser administrada pelo runtime do mesmo ambiente',
      );
    }
    return runtime as IntegrationEnvironment;
  }

  private whereScope(scope: IntegrationConnectionScope) {
    assertIntegrationScope(scope);
    return {
      scope: scope.scope as IntegrationScope,
      gymId: scope.scope === 'TENANT' ? scope.gymId!.trim() : null,
    };
  }

  async list(scope: IntegrationConnectionScope): Promise<IntegrationCredentialSafeView[]> {
    const where = this.whereScope(scope);
    const runtime = this.runtimeEnvironment.current() as IntegrationEnvironment;
    const rows = await this.prisma.integrationConnection.findMany({
      where: {
        ...where,
        environment: runtime,
      },
      orderBy: [{ providerCode: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(safeView);
  }

  async create(
    scope: IntegrationConnectionScope,
    userId: string,
    dto: CreateIntegrationCredentialDto,
  ): Promise<IntegrationCredentialSafeView> {
    await this.stepUp(userId, dto);
    const where = this.whereScope(scope);
    const environment = await this.requireActiveRuntimeEnvironment(dto.environment);
    assertPublicIntegrationConfiguration(dto.publicConfiguration);

    const providerCode = assertProviderCode(dto.providerCode);
    const provider = this.providers.require(providerCode);
    if (!provider.environments.includes(dto.environment)) {
      throw new BadRequestException('Provider nao homologado para este environment');
    }
    if (!provider.authModels.includes(dto.authModel)) {
      throw new BadRequestException('authModel nao suportado pelo provider');
    }

    const capabilities = [...new Set(dto.capabilities.map(assertCapability))];
    if (capabilities.length === 0) {
      throw new BadRequestException('Conexao exige ao menos uma capability');
    }
    for (const capability of capabilities) {
      if (!provider.capabilities.includes(capability)) {
        throw new BadRequestException(
          'Capability ' + capability + ' nao suportada pelo provider',
        );
      }
    }

    const pending = await this.prisma.integrationConnection.create({
      data: {
        ...where,
        providerCode,
        environment,
        authModel: dto.authModel,
        status: IntegrationConnectionStatus.PENDING,
        capabilities,
        publicConfiguration: dto.publicConfiguration
          ? JSON.parse(JSON.stringify(dto.publicConfiguration))
          : undefined,
        createdByUserId: userId,
      },
    });

    const reference = newIntegrationSecretReference();
    let physical: { version: number; expiresAt?: Date | null };
    try {
      physical = await this.vault.putSecret({
        reference,
        value: dto.secret,
      });
    } catch (error) {
      await this.prisma.integrationConnection
        .delete({ where: { id: pending.id } })
        .catch(() => undefined);
      throw error;
    }

    const now = new Date();
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.integrationConnection.update({
          where: { id: pending.id },
          data: {
            status: IntegrationConnectionStatus.ACTIVE,
            secretReference: reference,
            secretVersion: physical.version,
            secretRotatedAt: now,
            secretExpiresAt: physical.expiresAt ?? null,
            secretRevokedAt: null,
            lastVerifiedAt: now,
          },
        });
        await this.audit.record(
          {
            gymId: where.gymId,
            userId,
            action: 'INTEGRATION_CREDENTIAL_CREATED',
            entity: 'IntegrationConnection',
            entityId: row.id,
            next: {
              providerCode: row.providerCode,
              environment: row.environment,
              authModel: row.authModel,
              capabilities: row.capabilities,
              publicConfiguration: row.publicConfiguration,
              secretReference: row.secretReference,
              secretVersion: row.secretVersion,
              status: row.status,
            },
          },
          tx,
        );
        return row;
      });
      return safeView(created);
    } catch (error) {
      await this.vault.revokeSecret(reference).catch(() => undefined);
      await this.prisma.integrationConnection
        .delete({ where: { id: pending.id } })
        .catch(() => undefined);
      throw error;
    }
  }

  private async requireConnection(
    scope: IntegrationConnectionScope,
    connectionId: string,
  ) {
    const where = this.whereScope(scope);
    const runtime = this.runtimeEnvironment.current() as IntegrationEnvironment;
    const connection = await this.prisma.integrationConnection.findFirst({
      where: {
        id: connectionId,
        ...where,
        environment: runtime,
      },
    });
    if (!connection) {
      throw new BadRequestException(
        'Integration connection indisponivel no escopo/ambiente ativo',
      );
    }
    return { connection, where };
  }

  async rotate(
    scope: IntegrationConnectionScope,
    connectionId: string,
    userId: string,
    dto: RotateIntegrationCredentialDto,
  ): Promise<IntegrationCredentialSafeView> {
    await this.stepUp(userId, dto);
    const { connection, where } = await this.requireConnection(scope, connectionId);

    if (
      !connection.secretReference ||
      !connection.secretVersion ||
      !connection.secretRotatedAt ||
      connection.secretRevokedAt
    ) {
      throw new ConflictException('Conexao nao possui credencial ativa para rotacao');
    }

    const physical = await this.vault.putSecret({
      reference: connection.secretReference,
      value: dto.secret,
      expectedVersion: connection.secretVersion,
    });

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.integrationConnection.updateMany({
        where: {
          id: connection.id,
          scope: connection.scope,
          gymId: connection.gymId,
          environment: connection.environment,
          secretReference: connection.secretReference,
          secretVersion: connection.secretVersion,
          secretRevokedAt: null,
        },
        data: {
          status: IntegrationConnectionStatus.ACTIVE,
          secretVersion: physical.version,
          secretRotatedAt: now,
          secretExpiresAt: physical.expiresAt ?? null,
          lastVerifiedAt: now,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'Estado da credencial mudou durante a rotacao; resolucao permanece fail-closed',
        );
      }
      const row = await tx.integrationConnection.findUniqueOrThrow({
        where: { id: connection.id },
      });
      await this.audit.record(
        {
          gymId: where.gymId,
          userId,
          action: 'INTEGRATION_CREDENTIAL_ROTATED',
          entity: 'IntegrationConnection',
          entityId: row.id,
          previous: {
            secretReference: connection.secretReference,
            secretVersion: connection.secretVersion,
            secretRotatedAt: connection.secretRotatedAt,
          },
          next: {
            secretReference: row.secretReference,
            secretVersion: row.secretVersion,
            secretRotatedAt: row.secretRotatedAt,
            secretExpiresAt: row.secretExpiresAt,
          },
        },
        tx,
      );
      return row;
    });

    return safeView(updated);
  }

  async verify(
    scope: IntegrationConnectionScope,
    connectionId: string,
    userId: string,
    stepUp: StepUpInput,
  ) {
    await this.stepUp(userId, stepUp);
    const { connection, where } = await this.requireConnection(scope, connectionId);
    if (
      !connection.secretReference ||
      !connection.secretVersion ||
      connection.secretRevokedAt
    ) {
      throw new ConflictException('Conexao sem credencial ativa para verificacao');
    }

    const physical = await this.vault.getSecret(connection.secretReference);
    if (physical.version !== connection.secretVersion) {
      throw new ServiceUnavailableException(
        'Versao fisica da credencial diverge do estado canonico',
      );
    }

    const verifiedAt = new Date();
    const changed = await this.prisma.integrationConnection.updateMany({
      where: {
        id: connection.id,
        secretVersion: connection.secretVersion,
        secretRevokedAt: null,
      },
      data: {
        lastVerifiedAt: verifiedAt,
        status: IntegrationConnectionStatus.ACTIVE,
      },
    });
    if (changed.count !== 1) {
      throw new ConflictException('Credencial mudou durante a verificacao');
    }

    await this.audit.record({
      gymId: where.gymId,
      userId,
      action: 'INTEGRATION_CREDENTIAL_VERIFIED',
      entity: 'IntegrationConnection',
      entityId: connection.id,
      next: {
        secretReference: connection.secretReference,
        secretVersion: connection.secretVersion,
        lastVerifiedAt: verifiedAt,
      },
    });

    return {
      id: connection.id,
      verified: true,
      secretVersion: connection.secretVersion,
      lastVerifiedAt: verifiedAt,
    };
  }

  async revoke(
    scope: IntegrationConnectionScope,
    connectionId: string,
    userId: string,
    stepUp: StepUpInput,
  ) {
    await this.stepUp(userId, stepUp);
    const { connection, where } = await this.requireConnection(scope, connectionId);
    if (!connection.secretReference) {
      throw new ConflictException('Conexao sem credencial para revogacao');
    }

    const revokedAt = connection.secretRevokedAt ?? new Date();
    if (!connection.secretRevokedAt) {
      await this.prisma.$transaction(async (tx) => {
        await tx.integrationConnection.update({
          where: { id: connection.id },
          data: {
            status: IntegrationConnectionStatus.DISCONNECTED,
            secretRevokedAt: revokedAt,
          },
        });
        await this.audit.record(
          {
            gymId: where.gymId,
            userId,
            action: 'INTEGRATION_CREDENTIAL_REVOKED',
            entity: 'IntegrationConnection',
            entityId: connection.id,
            previous: {
              status: connection.status,
              secretReference: connection.secretReference,
              secretVersion: connection.secretVersion,
              secretRevokedAt: connection.secretRevokedAt,
            },
            next: {
              status: IntegrationConnectionStatus.DISCONNECTED,
              secretReference: connection.secretReference,
              secretVersion: connection.secretVersion,
              secretRevokedAt: revokedAt,
            },
          },
          tx,
        );
      });
    }

    try {
      await this.vault.revokeSecret(connection.secretReference);
    } catch {
      throw new ServiceUnavailableException(
        'Credencial ja esta bloqueada no IRON, mas a revogacao fisica do Vault requer retry',
      );
    }

    return {
      id: connection.id,
      revoked: true,
      revokedAt,
      physicalRevocation: 'SCHEDULED',
    };
  }
}
