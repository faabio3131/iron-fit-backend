import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
  IntegrationSecretCleanupStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthSecurityService } from '../auth/auth-security.service';
import { TenantProductEntitlementsService } from '../product-entitlements/tenant-product-entitlements.service';
import {
  assertCapability,
  assertIntegrationScope,
  assertPublicIntegrationConfiguration,
  assertProviderCode,
  IntegrationConnectionScope,
  IntegrationProviderDescriptor,
  newIntegrationSecretReference,
} from './contracts/integration-contract';
import {
  CreateIntegrationCredentialDto,
  RotateIntegrationCredentialDto,
} from './dto/integration-credential-admin.dto';
import { IntegrationCredentialProbeRegistry } from './provider-credential-probe.registry';
import { IntegrationProviderRegistry } from './provider-registry.service';
import { IntegrationRuntimeEnvironmentService } from './runtime-environment.service';
import {
  INTEGRATION_SECRET_VAULT,
  IntegrationSecretValue,
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
      connection.secretReference &&
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
    private readonly entitlements: TenantProductEntitlementsService,
    private readonly probes: IntegrationCredentialProbeRegistry,
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

  private whereScope(scope: IntegrationConnectionScope) {
    assertIntegrationScope(scope);
    return {
      scope: scope.scope as IntegrationScope,
      gymId: scope.scope === 'TENANT' ? scope.gymId!.trim() : null,
    };
  }

  private async assertTenantProviderAllowed(
    scope: IntegrationConnectionScope,
    provider: Readonly<IntegrationProviderDescriptor>,
  ) {
    if (scope.scope !== 'TENANT') return;

    const featureKey = provider.tenantEntitlementFeatureKey;
    if (!featureKey) {
      throw new ForbiddenException(
        'Provider nao possui entitlement comercial configurado para tenant',
      );
    }

    const resolution = await this.entitlements.resolveFeature(
      scope.gymId,
      featureKey,
    );
    if (resolution.kind !== 'FEATURE' || resolution.value !== true) {
      throw new ForbiddenException(
        'Plano/configuracao do tenant nao autoriza esta integracao',
      );
    }
  }

  private async recordCleanupPending(
    connectionId: string | null,
    reference: string,
    reason: string,
    userId: string,
    gymId: string | null,
  ) {
    const now = new Date();
    const task = await this.prisma.integrationSecretCleanupTask.upsert({
      where: { secretReference: reference },
      create: {
        integrationConnectionId: connectionId,
        secretReference: reference,
        reason,
        status: IntegrationSecretCleanupStatus.PENDING,
        attempts: 1,
        lastAttemptAt: now,
      },
      update: {
        integrationConnectionId: connectionId,
        reason,
        status: IntegrationSecretCleanupStatus.PENDING,
        attempts: { increment: 1 },
        lastAttemptAt: now,
        completedAt: null,
      },
    });

    await this.audit.record({
      gymId,
      userId,
      action: 'INTEGRATION_SECRET_CLEANUP_PENDING',
      entity: 'IntegrationSecretCleanupTask',
      entityId: task.id,
      next: {
        reason,
        cleanupPending: true,
      },
    });
  }

  private async markCleanupCompleted(reference: string) {
    await this.prisma.integrationSecretCleanupTask.updateMany({
      where: {
        secretReference: reference,
        status: IntegrationSecretCleanupStatus.PENDING,
      },
      data: {
        status: IntegrationSecretCleanupStatus.COMPLETED,
        completedAt: new Date(),
        lastAttemptAt: new Date(),
      },
    });
  }

  async list(
    scope: IntegrationConnectionScope,
  ): Promise<IntegrationCredentialSafeView[]> {
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
    const environment = this.runtimeEnvironment.current() as IntegrationEnvironment;
    assertPublicIntegrationConfiguration(dto.publicConfiguration);

    const providerCode = assertProviderCode(dto.providerCode);
    const provider = this.providers.require(providerCode);
    await this.assertTenantProviderAllowed(scope, provider);

    if (!provider.environments.includes(environment)) {
      throw new BadRequestException(
        'Provider nao homologado para o ambiente ativo',
      );
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
        const changed = await tx.integrationConnection.updateMany({
          where: {
            id: pending.id,
            status: IntegrationConnectionStatus.PENDING,
            secretReference: null,
          },
          data: {
            status: IntegrationConnectionStatus.ACTIVE,
            secretReference: reference,
            secretVersion: physical.version,
            secretRotatedAt: now,
            secretExpiresAt: physical.expiresAt ?? null,
            secretRevokedAt: null,
            lastVerifiedAt: null,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException(
            'Connection mudou durante configuracao de credencial',
          );
        }

        const row = await tx.integrationConnection.findUniqueOrThrow({
          where: { id: pending.id },
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
              credentialConfigured: true,
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
      try {
        await this.vault.revokeSecret(reference);
      } catch {
        await this.recordCleanupPending(
          pending.id,
          reference,
          'CREATE_ROLLBACK_REFERENCE',
          userId,
          where.gymId,
        ).catch(() => undefined);
      }
      await this.prisma.integrationConnection
        .deleteMany({
          where: {
            id: pending.id,
            status: IntegrationConnectionStatus.PENDING,
            secretReference: null,
          },
        })
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

  private async replaceInternal(
    scope: IntegrationConnectionScope,
    connectionId: string,
    userId: string,
    dto: RotateIntegrationCredentialDto,
    action: 'REPLACED' | 'ROTATED',
  ): Promise<IntegrationCredentialSafeView & {
    previousCredentialRevocationScheduled: boolean;
  }> {
    await this.stepUp(userId, dto);
    const { connection, where } = await this.requireConnection(
      scope,
      connectionId,
    );

    const provider = this.providers.require(connection.providerCode);
    await this.assertTenantProviderAllowed(scope, provider);

    if (
      !connection.secretReference ||
      !connection.secretVersion ||
      !connection.secretRotatedAt ||
      connection.secretRevokedAt
    ) {
      throw new ConflictException(
        'Conexao nao possui credencial ativa para troca',
      );
    }

    const oldReference = connection.secretReference;
    const oldVersion = connection.secretVersion;
    const newReference = newIntegrationSecretReference();

    let physical: { version: number; expiresAt?: Date | null };
    try {
      physical = await this.vault.putSecret({
        reference: newReference,
        value: dto.secret,
      });
    } catch (error) {
      throw error;
    }

    const now = new Date();
    let updated: any;

    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.integrationConnection.updateMany({
          where: {
            id: connection.id,
            scope: connection.scope,
            gymId: connection.gymId,
            environment: connection.environment,
            secretReference: oldReference,
            secretVersion: oldVersion,
            secretRevokedAt: null,
          },
          data: {
            status: IntegrationConnectionStatus.ACTIVE,
            secretReference: newReference,
            secretVersion: physical.version,
            secretRotatedAt: now,
            secretExpiresAt: physical.expiresAt ?? null,
            secretLastUsedAt: null,
            secretRevokedAt: null,
            lastVerifiedAt: null,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException(
            'Estado da credencial mudou durante a troca',
          );
        }

        const row = await tx.integrationConnection.findUniqueOrThrow({
          where: { id: connection.id },
        });
        await this.audit.record(
          {
            gymId: where.gymId,
            userId,
            action: 'INTEGRATION_CREDENTIAL_' + action,
            entity: 'IntegrationConnection',
            entityId: row.id,
            previous: {
              credentialConfigured: true,
              secretVersion: oldVersion,
            },
            next: {
              credentialConfigured: true,
              secretVersion: row.secretVersion,
              secretRotatedAt: row.secretRotatedAt,
              lastVerifiedAt: null,
            },
          },
          tx,
        );
        return row;
      });
    } catch (error) {
      try {
        await this.vault.revokeSecret(newReference);
      } catch {
        await this.recordCleanupPending(
          connection.id,
          newReference,
          'ROTATION_ROLLBACK_REFERENCE',
          userId,
          where.gymId,
        ).catch(() => undefined);
      }
      throw error;
    }

    let previousCredentialRevocationScheduled = true;
    try {
      await this.vault.revokeSecret(oldReference);
    } catch {
      previousCredentialRevocationScheduled = false;
      await this.recordCleanupPending(
        connection.id,
        oldReference,
        'ROTATION_OLD_REFERENCE',
        userId,
        where.gymId,
      );
    }

    return {
      ...safeView(updated),
      previousCredentialRevocationScheduled,
    };
  }

  rotate(
    scope: IntegrationConnectionScope,
    connectionId: string,
    userId: string,
    dto: RotateIntegrationCredentialDto,
  ) {
    return this.replaceInternal(
      scope,
      connectionId,
      userId,
      dto,
      'ROTATED',
    );
  }

  replace(
    scope: IntegrationConnectionScope,
    connectionId: string,
    userId: string,
    dto: RotateIntegrationCredentialDto,
  ) {
    return this.replaceInternal(
      scope,
      connectionId,
      userId,
      dto,
      'REPLACED',
    );
  }

  async verify(
    scope: IntegrationConnectionScope,
    connectionId: string,
    userId: string,
    stepUp: StepUpInput,
  ) {
    await this.stepUp(userId, stepUp);
    const { connection, where } = await this.requireConnection(
      scope,
      connectionId,
    );

    const provider = this.providers.require(connection.providerCode);
    await this.assertTenantProviderAllowed(scope, provider);

    if (
      !connection.secretReference ||
      !connection.secretVersion ||
      connection.secretRevokedAt
    ) {
      throw new ConflictException(
        'Conexao sem credencial ativa para verificacao',
      );
    }

    const physical = await this.vault.getSecret(connection.secretReference);
    if (physical.version !== connection.secretVersion) {
      throw new ServiceUnavailableException(
        'Versao fisica da credencial diverge do estado canonico',
      );
    }

    const probe = this.probes.require(connection.providerCode);
    await probe.verify({
      providerCode: connection.providerCode,
      authModel: connection.authModel,
      capabilities: Array.isArray(connection.capabilities)
        ? connection.capabilities.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      publicConfiguration:
        connection.publicConfiguration &&
        typeof connection.publicConfiguration === 'object' &&
        !Array.isArray(connection.publicConfiguration)
          ? (connection.publicConfiguration as Record<string, unknown>)
          : null,
      secret: new IntegrationSecretValue(physical.value),
    });

    const verifiedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.integrationConnection.updateMany({
        where: {
          id: connection.id,
          secretReference: connection.secretReference,
          secretVersion: connection.secretVersion,
          secretRevokedAt: null,
        },
        data: {
          lastVerifiedAt: verifiedAt,
          status: IntegrationConnectionStatus.ACTIVE,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'Credencial mudou durante a verificacao do provider',
        );
      }

      await this.audit.record(
        {
          gymId: where.gymId,
          userId,
          action: 'INTEGRATION_CREDENTIAL_VERIFIED',
          entity: 'IntegrationConnection',
          entityId: connection.id,
          next: {
            providerCode: connection.providerCode,
            secretVersion: connection.secretVersion,
            lastVerifiedAt: verifiedAt,
          },
        },
        tx,
      );
    });

    return {
      id: connection.id,
      verified: true,
      providerCode: connection.providerCode,
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
    const { connection, where } = await this.requireConnection(
      scope,
      connectionId,
    );
    if (!connection.secretReference) {
      throw new ConflictException('Conexao sem credencial para revogacao');
    }

    const reference = connection.secretReference;

    if (connection.secretRevokedAt) {
      const pending = await this.prisma.integrationSecretCleanupTask.findUnique({
        where: { secretReference: reference },
      });

      if (pending?.status === IntegrationSecretCleanupStatus.PENDING) {
        try {
          await this.vault.revokeSecret(reference);
          await this.markCleanupCompleted(reference);
          return {
            id: connection.id,
            revoked: true,
            revokedAt: connection.secretRevokedAt,
            physicalRevocation: 'SCHEDULED',
            idempotent: true,
          };
        } catch {
          await this.recordCleanupPending(
            connection.id,
            reference,
            'REVOKE_PENDING',
            userId,
            where.gymId,
          ).catch(() => undefined);
          return {
            id: connection.id,
            revoked: true,
            revokedAt: connection.secretRevokedAt,
            physicalRevocation: 'PENDING_RETRY',
            idempotent: true,
          };
        }
      }

      return {
        id: connection.id,
        revoked: true,
        revokedAt: connection.secretRevokedAt,
        physicalRevocation: 'SCHEDULED',
        idempotent: true,
      };
    }

    const revokedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.integrationConnection.updateMany({
        where: {
          id: connection.id,
          secretReference: reference,
          secretRevokedAt: null,
        },
        data: {
          status: IntegrationConnectionStatus.DISCONNECTED,
          secretRevokedAt: revokedAt,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'Connection mudou durante revogacao',
        );
      }

      await this.audit.record(
        {
          gymId: where.gymId,
          userId,
          action: 'INTEGRATION_CREDENTIAL_REVOKED',
          entity: 'IntegrationConnection',
          entityId: connection.id,
          previous: {
            status: connection.status,
            secretVersion: connection.secretVersion,
            credentialConfigured: true,
          },
          next: {
            status: IntegrationConnectionStatus.DISCONNECTED,
            secretVersion: connection.secretVersion,
            secretRevokedAt: revokedAt,
            credentialConfigured: false,
          },
        },
        tx,
      );
    });

    try {
      await this.vault.revokeSecret(reference);
      return {
        id: connection.id,
        revoked: true,
        revokedAt,
        physicalRevocation: 'SCHEDULED',
        idempotent: false,
      };
    } catch {
      await this.recordCleanupPending(
        connection.id,
        reference,
        'REVOKE_PENDING',
        userId,
        where.gymId,
      );
      return {
        id: connection.id,
        revoked: true,
        revokedAt,
        physicalRevocation: 'PENDING_RETRY',
        idempotent: false,
      };
    }
  }
}
