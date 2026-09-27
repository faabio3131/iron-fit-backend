import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationEnvironment,
  IntegrationScope,
  IntegrationSecretStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthSecurityService } from '../auth/auth-security.service';
import {
  IntegrationSecretPayload,
  IntegrationVaultPort,
  INTEGRATION_VAULT,
} from './contracts/integration-vault.port';
import {
  CreateIntegrationConnectionDto,
  PutIntegrationSecretDto,
  RevokeIntegrationSecretDto,
  UpdateIntegrationConfigurationDto,
  VerifyIntegrationSecretDto,
} from './dto/integrations-admin.dto';
import {
  IntegrationProviderDefinition,
  IntegrationProviderRegistry,
} from './integration-provider.registry';
import { IntegrationSecretReferenceService } from './integration-secret-reference.service';
import { IntegrationSecretResolverService } from './integration-secret-resolver.service';

const SERIALIZABLE_ATTEMPTS = 3;
const MAX_SECRET_FIELDS = 32;
const MAX_SECRET_BYTES = 128 * 1024;

type ScopeContext = {
  scope: IntegrationScope;
  gymId: string | null;
};

@Injectable()
export class IntegrationsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly security: AuthSecurityService,
    private readonly registry: IntegrationProviderRegistry,
    private readonly references: IntegrationSecretReferenceService,
    private readonly resolver: IntegrationSecretResolverService,
    @Inject(INTEGRATION_VAULT)
    private readonly vault: IntegrationVaultPort,
  ) {}

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable || attempt === SERIALIZABLE_ATTEMPTS) throw error;
      }
    }
    throw new ConflictException('Falha de concorrencia em integracoes');
  }

  private tenantContext(gymId?: string | null): ScopeContext {
    if (!gymId?.trim()) throw new BadRequestException('Tenant ativo obrigatorio');
    return { scope: IntegrationScope.TENANT, gymId: gymId.trim() };
  }

  private globalContext(): ScopeContext {
    return { scope: IntegrationScope.GLOBAL, gymId: null };
  }

  private async stepUp(
    actorUserId: string,
    dto: {
      currentPassword: string;
      mfaCode?: string;
      recoveryCode?: string;
    },
  ) {
    await this.security.assertStepUp(
      actorUserId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );
  }

  private assertEnvironment(
    provider: Readonly<IntegrationProviderDefinition>,
    environment: IntegrationEnvironment,
  ) {
    if (!provider.environments.includes(environment)) {
      throw new BadRequestException('Ambiente nao suportado pelo provider');
    }
    this.references.assertRuntimeEnvironment(environment);
  }

  private publicConfiguration(
    provider: Readonly<IntegrationProviderDefinition>,
    raw?: Record<string, unknown>,
  ): Prisma.InputJsonValue {
    const input = raw ?? {};
    const allowed = new Set(provider.publicConfigurationKeys);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        throw new BadRequestException(
          'Chave publica nao autorizada para o provider',
        );
      }
    }
    for (const secretKey of provider.secretKeys) {
      if (Object.prototype.hasOwnProperty.call(input, secretKey)) {
        throw new BadRequestException(
          'Segredo nao pode ser salvo em publicConfiguration',
        );
      }
    }
    return input as Prisma.InputJsonValue;
  }

  private secretPayload(
    provider: Readonly<IntegrationProviderDefinition>,
    raw: Record<string, unknown>,
  ): IntegrationSecretPayload {
    const entries = Object.entries(raw ?? {});
    if (
      provider.secretKeys.length === 0 ||
      entries.length === 0 ||
      entries.length > MAX_SECRET_FIELDS
    ) {
      throw new BadRequestException('Payload secreto invalido');
    }

    const allowed = new Set(provider.secretKeys);
    const output: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (!allowed.has(key)) {
        throw new BadRequestException(
          'Chave secreta nao autorizada para o provider',
        );
      }
      if (typeof value !== 'string' || value.length === 0) {
        throw new BadRequestException('Valor secreto deve ser string nao vazia');
      }
      output[key] = value;
    }

    for (const required of provider.secretKeys) {
      if (!(required in output)) {
        throw new BadRequestException(
          'Credencial obrigatoria do provider ausente',
        );
      }
    }

    if (Buffer.byteLength(JSON.stringify(output), 'utf8') > MAX_SECRET_BYTES) {
      throw new BadRequestException('Payload secreto excede limite');
    }
    return Object.freeze(output);
  }

  private async scopedConnection(
    connectionId: string,
    context: ScopeContext,
  ) {
    const connection = await this.prisma.integrationConnection.findFirst({
      where: {
        id: connectionId,
        scope: context.scope,
        gymId: context.gymId,
      },
      include: {
        secretVersions: {
          orderBy: { version: 'desc' },
          take: 20,
        },
      },
    });
    if (!connection) throw new NotFoundException('Integracao nao encontrada');
    return connection;
  }

  private safe(connection: any) {
    const latest = connection.secretVersions?.[0] ?? null;
    return {
      id: connection.id,
      scope: connection.scope,
      gymId: connection.gymId,
      providerCode: connection.providerCode,
      environment: connection.environment,
      status: connection.status,
      capabilities: connection.capabilities,
      publicConfiguration: connection.publicConfiguration,
      secretConfigured:
        latest?.status === IntegrationSecretStatus.ACTIVE &&
        !latest?.revokedAt &&
        (!latest?.expiresAt || latest.expiresAt > new Date()),
      secretMetadata: latest
        ? {
            version: latest.version,
            status: latest.status,
            createdAt: latest.createdAt,
            rotatedAt: latest.rotatedAt,
            expiresAt: latest.expiresAt,
            lastUsedAt: latest.lastUsedAt,
            lastVerifiedAt: latest.lastVerifiedAt,
            revokedAt: latest.revokedAt,
          }
        : null,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }

  providers() {
    return this.registry.list();
  }

  async listTenant(gymId?: string | null) {
    const context = this.tenantContext(gymId);
    const rows = await this.prisma.integrationConnection.findMany({
      where: { scope: context.scope, gymId: context.gymId },
      include: {
        secretVersions: { orderBy: { version: 'desc' }, take: 1 },
      },
      orderBy: [{ providerCode: 'asc' }, { environment: 'asc' }],
    });
    return rows.map((row) => this.safe(row));
  }

  async listGlobal() {
    const context = this.globalContext();
    const rows = await this.prisma.integrationConnection.findMany({
      where: { scope: context.scope, gymId: null },
      include: {
        secretVersions: { orderBy: { version: 'desc' }, take: 1 },
      },
      orderBy: [{ providerCode: 'asc' }, { environment: 'asc' }],
    });
    return rows.map((row) => this.safe(row));
  }

  async createTenant(
    gymId: string | null | undefined,
    actorUserId: string,
    dto: CreateIntegrationConnectionDto,
  ) {
    return this.create(this.tenantContext(gymId), actorUserId, dto);
  }

  async createGlobal(
    actorUserId: string,
    dto: CreateIntegrationConnectionDto,
  ) {
    return this.create(this.globalContext(), actorUserId, dto);
  }

  private async create(
    context: ScopeContext,
    actorUserId: string,
    dto: CreateIntegrationConnectionDto,
  ) {
    await this.stepUp(actorUserId, dto);
    const provider = this.registry.get(dto.providerCode);
    this.assertEnvironment(provider, dto.environment);
    const publicConfiguration = this.publicConfiguration(
      provider,
      dto.publicConfiguration,
    );

    try {
      const created = await this.prisma.integrationConnection.create({
        data: {
          scope: context.scope,
          gymId: context.gymId,
          providerCode: provider.providerCode,
          environment: dto.environment,
          status: IntegrationConnectionStatus.PENDING,
          capabilities: [...provider.capabilities] as Prisma.InputJsonValue,
          publicConfiguration,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        },
        include: {
          secretVersions: { orderBy: { version: 'desc' }, take: 1 },
        },
      });
      await this.audit.record({
        gymId: context.gymId,
        userId: actorUserId,
        action: 'INTEGRATION_CONNECTION_CREATED',
        entity: 'IntegrationConnection',
        entityId: created.id,
        next: {
          scope: created.scope,
          providerCode: created.providerCode,
          environment: created.environment,
          secretConfigured: false,
        },
      });
      return this.safe(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Integracao ja existe para provider/ambiente neste escopo',
        );
      }
      throw error;
    }
  }

  async updateTenantConfiguration(
    connectionId: string,
    gymId: string | null | undefined,
    actorUserId: string,
    dto: UpdateIntegrationConfigurationDto,
  ) {
    return this.updateConfiguration(
      connectionId,
      this.tenantContext(gymId),
      actorUserId,
      dto,
    );
  }

  async updateGlobalConfiguration(
    connectionId: string,
    actorUserId: string,
    dto: UpdateIntegrationConfigurationDto,
  ) {
    return this.updateConfiguration(
      connectionId,
      this.globalContext(),
      actorUserId,
      dto,
    );
  }

  private async updateConfiguration(
    connectionId: string,
    context: ScopeContext,
    actorUserId: string,
    dto: UpdateIntegrationConfigurationDto,
  ) {
    await this.stepUp(actorUserId, dto);
    const connection = await this.scopedConnection(connectionId, context);
    const provider = this.registry.get(connection.providerCode);
    const publicConfiguration = this.publicConfiguration(
      provider,
      dto.publicConfiguration,
    );
    const active = connection.secretVersions.find(
      (version) => version.status === IntegrationSecretStatus.ACTIVE,
    );
    const updated = await this.prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        publicConfiguration,
        status: active
          ? IntegrationConnectionStatus.CONFIGURED
          : IntegrationConnectionStatus.PENDING,
        updatedByUserId: actorUserId,
      },
      include: {
        secretVersions: { orderBy: { version: 'desc' }, take: 1 },
      },
    });
    await this.audit.record({
      gymId: context.gymId,
      userId: actorUserId,
      action: 'INTEGRATION_CONFIGURATION_UPDATED',
      entity: 'IntegrationConnection',
      entityId: updated.id,
      next: {
        providerCode: updated.providerCode,
        environment: updated.environment,
        secretConfigured: Boolean(active),
      },
    });
    return this.safe(updated);
  }

  async putTenantSecret(
    connectionId: string,
    gymId: string | null | undefined,
    actorUserId: string,
    dto: PutIntegrationSecretDto,
  ) {
    return this.putSecret(
      connectionId,
      this.tenantContext(gymId),
      actorUserId,
      dto,
    );
  }

  async putGlobalSecret(
    connectionId: string,
    actorUserId: string,
    dto: PutIntegrationSecretDto,
  ) {
    return this.putSecret(
      connectionId,
      this.globalContext(),
      actorUserId,
      dto,
    );
  }

  private async putSecret(
    connectionId: string,
    context: ScopeContext,
    actorUserId: string,
    dto: PutIntegrationSecretDto,
  ) {
    await this.stepUp(actorUserId, dto);
    const connection = await this.scopedConnection(connectionId, context);
    const provider = this.registry.get(connection.providerCode);
    this.assertEnvironment(provider, connection.environment);
    const payload = this.secretPayload(provider, dto.credentials);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException('expiresAt deve estar no futuro');
    }

    const previousVersion = connection.secretVersions[0]?.version ?? 0;
    const nextVersion = previousVersion + 1;
    const referenceId = this.references.newReferenceId();
    const referencePath = this.references.path(connection, referenceId);
    const written = await this.vault.put(referencePath, payload);

    let created: any;
    try {
      created = await this.serializable(async (tx) => {
        const current = await tx.integrationSecretVersion.findFirst({
          where: { connectionId: connection.id },
          orderBy: { version: 'desc' },
        });
        if ((current?.version ?? 0) !== previousVersion) {
          throw new ConflictException(
            'Credencial mudou concorrentemente; repita a operacao',
          );
        }

        const now = new Date();
        await tx.integrationSecretVersion.updateMany({
          where: {
            connectionId: connection.id,
            status: IntegrationSecretStatus.ACTIVE,
          },
          data: {
            status: IntegrationSecretStatus.REVOKED,
            rotatedAt: now,
            revokedAt: now,
          },
        });

        await tx.integrationSecretVersion.create({
          data: {
            connectionId: connection.id,
            referenceId,
            version: nextVersion,
            status: IntegrationSecretStatus.ACTIVE,
            vaultVersion: written.version,
            createdByUserId: actorUserId,
            expiresAt,
          },
        });

        return tx.integrationConnection.update({
          where: { id: connection.id },
          data: {
            status: IntegrationConnectionStatus.CONFIGURED,
            updatedByUserId: actorUserId,
          },
          include: {
            secretVersions: { orderBy: { version: 'desc' }, take: 1 },
          },
        });
      });
    } catch (error) {
      await this.vault.destroy(referencePath).catch(() => undefined);
      throw error;
    }

    const previousActive = connection.secretVersions.filter(
      (version) => version.status === IntegrationSecretStatus.ACTIVE,
    );
    for (const previous of previousActive) {
      const previousPath = this.references.path(
        connection,
        previous.referenceId,
      );
      try {
        await this.vault.destroy(previousPath);
      } catch {
        await this.prisma.integrationConnection.update({
          where: { id: connection.id },
          data: { status: IntegrationConnectionStatus.DEGRADED },
        });
        await this.audit.record({
          gymId: context.gymId,
          userId: actorUserId,
          action: 'INTEGRATION_SECRET_OLD_VERSION_CLEANUP_FAILED',
          entity: 'IntegrationConnection',
          entityId: connection.id,
          next: {
            providerCode: connection.providerCode,
            environment: connection.environment,
            secretVersion: previous.version,
          },
        });
        throw new ServiceUnavailableException(
          'Nova credencial salva; limpeza da versao anterior requer intervencao',
        );
      }
    }

    await this.audit.record({
      gymId: context.gymId,
      userId: actorUserId,
      action:
        previousVersion > 0
          ? 'INTEGRATION_SECRET_ROTATED'
          : 'INTEGRATION_SECRET_CONFIGURED',
      entity: 'IntegrationConnection',
      entityId: connection.id,
      next: {
        providerCode: connection.providerCode,
        environment: connection.environment,
        secretVersion: nextVersion,
        expiresAt,
      },
    });

    return this.safe(created);
  }

  async verifyTenantSecret(
    connectionId: string,
    gymId: string | null | undefined,
    actorUserId: string,
    dto: VerifyIntegrationSecretDto,
  ) {
    return this.verifySecret(
      connectionId,
      this.tenantContext(gymId),
      actorUserId,
      dto,
    );
  }

  async verifyGlobalSecret(
    connectionId: string,
    actorUserId: string,
    dto: VerifyIntegrationSecretDto,
  ) {
    return this.verifySecret(
      connectionId,
      this.globalContext(),
      actorUserId,
      dto,
    );
  }

  private async verifySecret(
    connectionId: string,
    context: ScopeContext,
    actorUserId: string,
    dto: VerifyIntegrationSecretDto,
  ) {
    await this.stepUp(actorUserId, dto);
    const connection = await this.scopedConnection(connectionId, context);
    await this.resolver.resolveForVerification(connection.id, context);
    const updated = await this.prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: IntegrationConnectionStatus.ACTIVE,
        updatedByUserId: actorUserId,
      },
      include: {
        secretVersions: { orderBy: { version: 'desc' }, take: 1 },
      },
    });
    await this.audit.record({
      gymId: context.gymId,
      userId: actorUserId,
      action: 'INTEGRATION_SECRET_VERIFIED',
      entity: 'IntegrationConnection',
      entityId: connection.id,
      next: {
        providerCode: connection.providerCode,
        environment: connection.environment,
        secretVersion: updated.secretVersions[0]?.version ?? null,
      },
    });
    return this.safe(updated);
  }

  async revokeTenantSecret(
    connectionId: string,
    gymId: string | null | undefined,
    actorUserId: string,
    dto: RevokeIntegrationSecretDto,
  ) {
    return this.revokeSecret(
      connectionId,
      this.tenantContext(gymId),
      actorUserId,
      dto,
    );
  }

  async revokeGlobalSecret(
    connectionId: string,
    actorUserId: string,
    dto: RevokeIntegrationSecretDto,
  ) {
    return this.revokeSecret(
      connectionId,
      this.globalContext(),
      actorUserId,
      dto,
    );
  }

  private async revokeSecret(
    connectionId: string,
    context: ScopeContext,
    actorUserId: string,
    dto: RevokeIntegrationSecretDto,
  ) {
    await this.stepUp(actorUserId, dto);
    const connection = await this.scopedConnection(connectionId, context);
    const active = connection.secretVersions.filter(
      (version) => version.status === IntegrationSecretStatus.ACTIVE,
    );
    if (active.length === 0) {
      return this.safe(connection);
    }

    for (const version of active) {
      await this.vault.destroy(
        this.references.path(connection, version.referenceId),
      );
    }

    const now = new Date();
    const updated = await this.serializable(async (tx) => {
      await tx.integrationSecretVersion.updateMany({
        where: {
          connectionId: connection.id,
          status: IntegrationSecretStatus.ACTIVE,
        },
        data: {
          status: IntegrationSecretStatus.REVOKED,
          revokedAt: now,
        },
      });
      return tx.integrationConnection.update({
        where: { id: connection.id },
        data: {
          status: IntegrationConnectionStatus.REVOKED,
          updatedByUserId: actorUserId,
        },
        include: {
          secretVersions: { orderBy: { version: 'desc' }, take: 1 },
        },
      });
    });

    await this.audit.record({
      gymId: context.gymId,
      userId: actorUserId,
      action: 'INTEGRATION_SECRET_REVOKED',
      entity: 'IntegrationConnection',
      entityId: connection.id,
      next: {
        providerCode: connection.providerCode,
        environment: connection.environment,
        revokedVersions: active.map((version) => version.version),
      },
    });
    return this.safe(updated);
  }
}
