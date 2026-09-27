import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
  Prisma,
} from '@prisma/client';
import { AuthSecurityService } from '../auth/auth-security.service';
import { TenantProductEntitlementsService } from '../product-entitlements/tenant-product-entitlements.service';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertIntegrationScope,
  IntegrationConnectionScope,
  IntegrationProviderDescriptor,
  newIntegrationSecretReference,
} from './contracts/integration-contract';
import { CreateIntegrationAdminDto, IntegrationSecretWriteDto, IntegrationStepUpDto } from './dto/integration-admin.dto';
import { IntegrationConnectionService } from './integration-connection.service';
import { IntegrationCredentialProbeRegistry } from './provider-credential-probe.registry';
import { IntegrationProviderRegistry } from './provider-registry.service';
import { IntegrationRuntimeEnvironmentService } from './runtime-environment.service';
import { IntegrationSecretResolverService } from './secrets/integration-secret-resolver.service';
import {
  INTEGRATION_SECRET_VAULT,
  IntegrationSecretVaultPort,
} from './secrets/integration-secret-vault.port';

type ScopedActor = {
  userId: string;
  scope: IntegrationConnectionScope;
};

@Injectable()
export class IntegrationSecretAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authSecurity: AuthSecurityService,
    private readonly connections: IntegrationConnectionService,
    private readonly providers: IntegrationProviderRegistry,
    private readonly probes: IntegrationCredentialProbeRegistry,
    private readonly runtimeEnvironment: IntegrationRuntimeEnvironmentService,
    private readonly entitlements: TenantProductEntitlementsService,
    private readonly resolver: IntegrationSecretResolverService,
    @Inject(INTEGRATION_SECRET_VAULT)
    private readonly vault: IntegrationSecretVaultPort,
  ) {}

  private safeView(connection: any) {
    return {
      id: connection.id,
      scope: connection.scope,
      gymId: connection.gymId,
      providerCode: connection.providerCode,
      environment: connection.environment,
      authModel: connection.authModel,
      status: connection.status,
      capabilities: connection.capabilities,
      publicConfiguration: connection.publicConfiguration,
      credentialConfigured:
        Boolean(connection.secretReference)
        && !connection.secretRevokedAt,
      secretVersion: connection.secretVersion,
      secretRotatedAt: connection.secretRotatedAt,
      secretExpiresAt: connection.secretExpiresAt,
      secretLastUsedAt: connection.secretLastUsedAt,
      secretRevokedAt: connection.secretRevokedAt,
      lastVerifiedAt: connection.lastVerifiedAt,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }

  private async assertStepUp(actor: ScopedActor, dto: IntegrationStepUpDto) {
    await this.authSecurity.assertStepUp(
      actor.userId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );
  }

  private async assertTenantEntitlement(
    descriptor: Readonly<IntegrationProviderDescriptor>,
    gymId: string,
  ) {
    const featureKey = descriptor.tenantEntitlementFeatureKey;
    if (!featureKey) {
      throw new ForbiddenException(
        'Provider nao possui entitlement tenant configurado',
      );
    }

    const resolution = await this.entitlements.resolveFeature(gymId, featureKey);
    if (resolution.kind !== 'FEATURE' || resolution.value !== true) {
      throw new ForbiddenException(
        'Plano/configuracao do tenant nao autoriza esta integracao',
      );
    }
  }

  private async requireScopedConnection(actor: ScopedActor) {
    assertIntegrationScope(actor.scope);
    const environment = this.runtimeEnvironment.current() as IntegrationEnvironment;
    const connection = await this.prisma.integrationConnection.findFirst({
      where: {
        id: (actor as any).connectionId,
        scope: actor.scope.scope as IntegrationScope,
        gymId: actor.scope.scope === 'TENANT' ? actor.scope.gymId!.trim() : null,
        environment,
      },
    });
    if (!connection) {
      throw new NotFoundException(
        'Integration connection nao encontrada no escopo/ambiente ativo',
      );
    }
    return connection;
  }

  private async requireConnection(
    connectionId: string,
    actor: ScopedActor,
  ) {
    return this.requireScopedConnection({
      ...actor,
      connectionId,
    } as ScopedActor & { connectionId: string });
  }

  private async assertProviderAllowed(connectionOrDescriptor: any, actor: ScopedActor) {
    const descriptor = 'providerCode' in connectionOrDescriptor
      ? this.providers.require(connectionOrDescriptor.providerCode)
      : connectionOrDescriptor;

    if (actor.scope.scope === 'TENANT') {
      await this.assertTenantEntitlement(
        descriptor,
        actor.scope.gymId!.trim(),
      );
    }
    return descriptor;
  }

  async list(actor: ScopedActor) {
    assertIntegrationScope(actor.scope);
    const environment = this.runtimeEnvironment.current() as IntegrationEnvironment;
    const connections = await this.prisma.integrationConnection.findMany({
      where: {
        scope: actor.scope.scope as IntegrationScope,
        gymId: actor.scope.scope === 'TENANT' ? actor.scope.gymId!.trim() : null,
        environment,
      },
      orderBy: [{ providerCode: 'asc' }, { createdAt: 'asc' }],
    });
    return connections.map((connection) => this.safeView(connection));
  }

  async create(actor: ScopedActor, dto: CreateIntegrationAdminDto) {
    await this.assertStepUp(actor, dto);
    const descriptor = this.providers.require(dto.providerCode);
    await this.assertProviderAllowed(descriptor, actor);

    const environment = this.runtimeEnvironment.current();
    if (!descriptor.environments.includes(environment)) {
      throw new ConflictException(
        'Provider nao homologado para o ambiente ativo',
      );
    }

    const connection = await this.connections.create({
      scope: actor.scope.scope,
      gymId: actor.scope.scope === 'TENANT' ? actor.scope.gymId : undefined,
      providerCode: dto.providerCode,
      environment,
      authModel: dto.authModel,
      capabilities: dto.capabilities,
      publicConfiguration: dto.publicConfiguration,
      createdByUserId: actor.userId,
    });

    const reference = newIntegrationSecretReference();
    const now = new Date();

    try {
      const physical = await this.vault.putSecret({
        reference,
        value: dto.secretValue,
      });

      const completed = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.integrationConnection.updateMany({
          where: {
            id: connection.id,
            secretReference: null,
            status: IntegrationConnectionStatus.PENDING,
          },
          data: {
            status: IntegrationConnectionStatus.ACTIVE,
            secretReference: reference,
            secretVersion: physical.version,
            secretRotatedAt: now,
            secretExpiresAt: physical.expiresAt ?? null,
            secretRevokedAt: null,
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            'Connection mudou durante configuracao de credencial',
          );
        }

        const canonical = await tx.integrationConnection.findUnique({
          where: { id: connection.id },
        });
        await this.audit.record(
          {
            gymId: connection.gymId,
            userId: actor.userId,
            action: 'INTEGRATION_CONNECTION_CREDENTIAL_CREATED',
            entity: 'IntegrationConnection',
            entityId: connection.id,
            next: {
              providerCode: connection.providerCode,
              environment: connection.environment,
              credentialConfigured: true,
              secretVersion: physical.version,
            },
          },
          tx,
        );
        return canonical;
      });

      return this.safeView(completed);
    } catch (error) {
      await this.vault.revokeSecret(reference).catch(() => undefined);
      await this.prisma.integrationConnection.deleteMany({
        where: {
          id: connection.id,
          secretReference: null,
          status: IntegrationConnectionStatus.PENDING,
        },
      });
      throw error;
    }
  }

  private async replaceInternal(
    connectionId: string,
    actor: ScopedActor,
    dto: IntegrationSecretWriteDto,
    action: 'REPLACED' | 'ROTATED',
  ) {
    await this.assertStepUp(actor, dto);
    const connection = await this.requireConnection(connectionId, actor);
    await this.assertProviderAllowed(connection, actor);

    if (connection.secretRevokedAt) {
      throw new ConflictException('Credencial revogada deve ser recriada');
    }

    const oldReference = connection.secretReference;
    const oldVersion = connection.secretVersion;
    if (!oldReference || !oldVersion) {
      throw new ConflictException('Connection ainda nao possui credencial ativa');
    }

    const newReference = newIntegrationSecretReference();
    const now = new Date();

    let physical: { version: number; expiresAt?: Date | null };
    try {
      physical = await this.vault.putSecret({
        reference: newReference,
        value: dto.secretValue,
      });
    } catch (error) {
      throw error;
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const swapped = await tx.integrationConnection.updateMany({
          where: {
            id: connection.id,
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
        if (swapped.count !== 1) {
          throw new ConflictException(
            'Connection mudou durante troca de credencial',
          );
        }

        const canonical = await tx.integrationConnection.findUnique({
          where: { id: connection.id },
        });
        await this.audit.record(
          {
            gymId: connection.gymId,
            userId: actor.userId,
            action: 'INTEGRATION_SECRET_' + action,
            entity: 'IntegrationConnection',
            entityId: connection.id,
            previous: {
              credentialConfigured: true,
              secretVersion: oldVersion,
            },
            next: {
              credentialConfigured: true,
              secretVersion: physical.version,
            },
          },
          tx,
        );
        return canonical;
      });

      let previousCredentialRevocationScheduled = true;
      try {
        await this.vault.revokeSecret(oldReference);
      } catch {
        previousCredentialRevocationScheduled = false;
        await this.audit.record({
          gymId: connection.gymId,
          userId: actor.userId,
          action: 'INTEGRATION_OLD_SECRET_CLEANUP_PENDING',
          entity: 'IntegrationConnection',
          entityId: connection.id,
          next: { cleanupPending: true },
        });
      }

      return {
        ...this.safeView(updated),
        previousCredentialRevocationScheduled,
      };
    } catch (error) {
      await this.vault.revokeSecret(newReference).catch(() => undefined);
      throw error;
    }
  }

  replace(
    connectionId: string,
    actor: ScopedActor,
    dto: IntegrationSecretWriteDto,
  ) {
    return this.replaceInternal(connectionId, actor, dto, 'REPLACED');
  }

  rotate(
    connectionId: string,
    actor: ScopedActor,
    dto: IntegrationSecretWriteDto,
  ) {
    return this.replaceInternal(connectionId, actor, dto, 'ROTATED');
  }

  async test(
    connectionId: string,
    actor: ScopedActor,
    dto: IntegrationStepUpDto,
  ) {
    await this.assertStepUp(actor, dto);
    const connection = await this.requireConnection(connectionId, actor);
    await this.assertProviderAllowed(connection, actor);

    const probe = this.probes.require(connection.providerCode);
    const secret = await this.resolver.resolveForExternalBoundary(
      connection.id,
      actor.scope,
    );

    await probe.verify({
      providerCode: connection.providerCode,
      authModel: connection.authModel,
      capabilities: Array.isArray(connection.capabilities)
        ? connection.capabilities.filter((value): value is string => typeof value === 'string')
        : [],
      publicConfiguration:
        connection.publicConfiguration
        && typeof connection.publicConfiguration === 'object'
        && !Array.isArray(connection.publicConfiguration)
          ? connection.publicConfiguration as Record<string, unknown>
          : null,
      secret,
    });

    const verifiedAt = new Date();
    const updated = await this.prisma.integrationConnection.updateMany({
      where: {
        id: connection.id,
        secretReference: connection.secretReference,
        secretVersion: connection.secretVersion,
        secretRevokedAt: null,
      },
      data: { lastVerifiedAt: verifiedAt },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        'Credencial mudou durante verificacao do provider',
      );
    }

    await this.audit.record({
      gymId: connection.gymId,
      userId: actor.userId,
      action: 'INTEGRATION_CREDENTIAL_VERIFIED',
      entity: 'IntegrationConnection',
      entityId: connection.id,
      next: {
        providerCode: connection.providerCode,
        verifiedAt,
      },
    });

    const canonical = await this.requireConnection(connectionId, actor);
    return this.safeView(canonical);
  }

  async revoke(
    connectionId: string,
    actor: ScopedActor,
    dto: IntegrationStepUpDto,
  ) {
    await this.assertStepUp(actor, dto);
    const connection = await this.requireConnection(connectionId, actor);

    if (!connection.secretReference || connection.secretRevokedAt) {
      return {
        ...this.safeView(connection),
        physicalRevokeScheduled: Boolean(connection.secretRevokedAt),
        idempotent: true,
      };
    }

    const reference = connection.secretReference;
    const revokedAt = new Date();

    const canonical = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.integrationConnection.updateMany({
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
      if (updated.count !== 1) {
        throw new ConflictException(
          'Connection mudou durante revogacao',
        );
      }

      const current = await tx.integrationConnection.findUnique({
        where: { id: connection.id },
      });
      await this.audit.record(
        {
          gymId: connection.gymId,
          userId: actor.userId,
          action: 'INTEGRATION_SECRET_REVOKED',
          entity: 'IntegrationConnection',
          entityId: connection.id,
          next: {
            credentialConfigured: false,
            revokedAt,
          },
        },
        tx,
      );
      return current;
    });

    let physicalRevokeScheduled = true;
    try {
      await this.vault.revokeSecret(reference);
    } catch {
      physicalRevokeScheduled = false;
      await this.audit.record({
        gymId: connection.gymId,
        userId: actor.userId,
        action: 'INTEGRATION_PHYSICAL_SECRET_REVOKE_PENDING',
        entity: 'IntegrationConnection',
        entityId: connection.id,
        next: { cleanupPending: true },
      });
    }

    return {
      ...this.safeView(canonical),
      physicalRevokeScheduled,
      idempotent: false,
    };
  }
}
