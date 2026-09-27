import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationBreakGlassOperation,
  IntegrationBreakGlassStatus,
  IntegrationConnectionStatus,
  IntegrationEnvironment,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthSecurityService } from '../auth/auth-security.service';
import {
  IntegrationBreakGlassApproveDto,
  IntegrationBreakGlassExecuteDto,
  IntegrationBreakGlassRequestDto,
  IntegrationBreakGlassRevokeDto,
} from './dto/integration-break-glass.dto';
import { IntegrationCredentialProbeRegistry } from './provider-credential-probe.registry';
import { IntegrationRuntimeEnvironmentService } from './runtime-environment.service';
import {
  INTEGRATION_SECRET_VAULT,
  IntegrationSecretValue,
  IntegrationSecretVaultPort,
} from './secrets/integration-secret-vault.port';

const SECRET_REASON_PATTERN =
  /(-----BEGIN[^\n]{0,40}PRIVATE KEY-----|\bBearer\s+\S+|\b(?:api[_ -]?key|token|secret|password|authorization)\s*[:=]\s*\S+|\b(?:sk|rk)-[A-Za-z0-9_-]{16,})/i;

type BreakGlassStepUp =
  | IntegrationBreakGlassRequestDto
  | IntegrationBreakGlassApproveDto
  | IntegrationBreakGlassExecuteDto
  | IntegrationBreakGlassRevokeDto;

@Injectable()
export class IntegrationBreakGlassService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authSecurity: AuthSecurityService,
    private readonly runtime: IntegrationRuntimeEnvironmentService,
    private readonly probes: IntegrationCredentialProbeRegistry,
    private readonly audit: AuditService,
    @Inject(INTEGRATION_SECRET_VAULT)
    private readonly vault: IntegrationSecretVaultPort,
  ) {}

  private async assertBreakGlassStepUp(
    userId: string,
    dto: BreakGlassStepUp,
  ) {
    const user = await this.authSecurity.assertStepUp(
      userId,
      dto.currentPassword,
      dto.mfaCode,
      dto.recoveryCode,
    );
    if (!user.mfaEnabled) {
      throw new ForbiddenException(
        'Break-glass exige MFA habilitado para o administrador',
      );
    }
    return user;
  }

  private assertSafeReason(reason: string) {
    const normalized = reason.trim();
    if (SECRET_REASON_PATTERN.test(normalized)) {
      throw new ConflictException(
        'Motivo de break-glass nao pode conter credenciais ou segredos',
      );
    }
    return normalized;
  }

  private async expireStale() {
    const now = new Date();
    await this.prisma.integrationBreakGlassGrant.updateMany({
      where: {
        status: IntegrationBreakGlassStatus.APPROVED,
        expiresAt: { lte: now },
      },
      data: {
        status: IntegrationBreakGlassStatus.EXPIRED,
      },
    });
  }

  private safeView(grant: any, providerCode?: string | null) {
    return {
      id: grant.id,
      connectionId: grant.integrationConnectionId,
      providerCode: providerCode ?? null,
      operation: grant.operation,
      reason: grant.reason,
      status: grant.status,
      requestedTtlSeconds: grant.requestedTtlSeconds,
      requestedByUserId: grant.requestedByUserId,
      approvedByUserId: grant.approvedByUserId ?? null,
      approvedAt: grant.approvedAt ?? null,
      expiresAt: grant.expiresAt ?? null,
      executionStartedAt: grant.executionStartedAt ?? null,
      consumedAt: grant.consumedAt ?? null,
      failedAt: grant.failedAt ?? null,
      revokedAt: grant.revokedAt ?? null,
      createdAt: grant.createdAt,
      updatedAt: grant.updatedAt,
    };
  }

  private async requireConnection(connectionId: string) {
    const environment = this.runtime.current() as IntegrationEnvironment;
    const connection = await this.prisma.integrationConnection.findFirst({
      where: {
        id: connectionId,
        environment,
        status: {
          in: [
            IntegrationConnectionStatus.ACTIVE,
            IntegrationConnectionStatus.DEGRADED,
          ],
        },
        secretRevokedAt: null,
      },
    });

    if (
      !connection
      || !connection.secretReference
      || !connection.secretVersion
      || !connection.secretRotatedAt
    ) {
      throw new NotFoundException(
        'Connection elegivel para break-glass nao encontrada no ambiente ativo',
      );
    }

    if (
      connection.secretExpiresAt
      && connection.secretExpiresAt <= new Date()
    ) {
      throw new ConflictException(
        'Credencial expirada nao pode ser usada em break-glass',
      );
    }

    return connection;
  }

  async list() {
    await this.expireStale();
    const environment = this.runtime.current() as IntegrationEnvironment;
    const grants = await this.prisma.integrationBreakGlassGrant.findMany({
      where: {
        connection: { environment },
      },
      include: {
        connection: {
          select: { providerCode: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return grants.map((grant) =>
      this.safeView(grant, grant.connection?.providerCode),
    );
  }

  async request(
    userId: string,
    dto: IntegrationBreakGlassRequestDto,
  ) {
    await this.assertBreakGlassStepUp(userId, dto);
    await this.expireStale();
    const reason = this.assertSafeReason(dto.reason);
    const connection = await this.requireConnection(dto.connectionId);

    const grant = await this.prisma.integrationBreakGlassGrant.create({
      data: {
        integrationConnectionId: connection.id,
        operation: dto.operation as IntegrationBreakGlassOperation,
        reason,
        requestedTtlSeconds: dto.ttlSeconds,
        requestedByUserId: userId,
        status: IntegrationBreakGlassStatus.REQUESTED,
      },
    });

    await this.audit.record({
      gymId: connection.gymId,
      userId,
      action: 'INTEGRATION_BREAK_GLASS_REQUESTED',
      entity: 'IntegrationBreakGlassGrant',
      entityId: grant.id,
      next: {
        connectionId: connection.id,
        providerCode: connection.providerCode,
        operation: grant.operation,
        requestedTtlSeconds: grant.requestedTtlSeconds,
      },
    });

    return this.safeView(grant, connection.providerCode);
  }

  async approve(
    grantId: string,
    userId: string,
    dto: IntegrationBreakGlassApproveDto,
  ) {
    await this.assertBreakGlassStepUp(userId, dto);
    await this.expireStale();

    const grant = await this.prisma.integrationBreakGlassGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw new NotFoundException('Break-glass request inexistente');
    if (grant.requestedByUserId === userId) {
      throw new ForbiddenException(
        'Solicitante nao pode aprovar o proprio break-glass',
      );
    }
    if (grant.status !== IntegrationBreakGlassStatus.REQUESTED) {
      throw new ConflictException(
        'Break-glass nao esta pendente de aprovacao',
      );
    }

    const connection = await this.requireConnection(
      grant.integrationConnectionId,
    );
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + grant.requestedTtlSeconds * 1000,
    );

    const changed = await this.prisma.integrationBreakGlassGrant.updateMany({
      where: {
        id: grant.id,
        status: IntegrationBreakGlassStatus.REQUESTED,
        requestedByUserId: { not: userId },
        approvedByUserId: null,
      },
      data: {
        status: IntegrationBreakGlassStatus.APPROVED,
        approvedByUserId: userId,
        approvedAt: now,
        expiresAt,
      },
    });
    if (changed.count !== 1) {
      throw new ConflictException(
        'Break-glass mudou durante aprovacao',
      );
    }

    const approved = await this.prisma.integrationBreakGlassGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });

    await this.audit.record({
      gymId: connection.gymId,
      userId,
      action: 'INTEGRATION_BREAK_GLASS_APPROVED',
      entity: 'IntegrationBreakGlassGrant',
      entityId: grant.id,
      next: {
        connectionId: connection.id,
        providerCode: connection.providerCode,
        operation: grant.operation,
        expiresAt,
        distinctApprover: true,
      },
    });

    return this.safeView(approved, connection.providerCode);
  }

  async execute(
    grantId: string,
    userId: string,
    dto: IntegrationBreakGlassExecuteDto,
  ) {
    await this.expireStale();
    await this.assertBreakGlassStepUp(userId, dto);

    const grant = await this.prisma.integrationBreakGlassGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw new NotFoundException('Break-glass request inexistente');
    if (grant.requestedByUserId !== userId) {
      throw new ForbiddenException(
        'Somente o solicitante pode consumir o grant aprovado',
      );
    }
    if (
      grant.status !== IntegrationBreakGlassStatus.APPROVED
      || !grant.approvedByUserId
      || grant.approvedByUserId === userId
      || !grant.expiresAt
      || grant.expiresAt <= new Date()
    ) {
      throw new ConflictException(
        'Break-glass nao esta aprovado ou expirou',
      );
    }

    const connection = await this.requireConnection(
      grant.integrationConnectionId,
    );
    const executionStartedAt = new Date();

    const claimed = await this.prisma.integrationBreakGlassGrant.updateMany({
      where: {
        id: grant.id,
        status: IntegrationBreakGlassStatus.APPROVED,
        requestedByUserId: userId,
        approvedByUserId: { not: userId },
        expiresAt: { gt: executionStartedAt },
      },
      data: {
        status: IntegrationBreakGlassStatus.EXECUTING,
        executionStartedAt,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException(
        'Break-glass ja foi consumido, revogado ou expirou',
      );
    }

    try {
      const physical = await this.vault.getSecret(
        connection.secretReference,
      );
      if (physical.version !== connection.secretVersion) {
        throw new ServiceUnavailableException(
          'Versao fisica diverge do estado canonico',
        );
      }
      if (physical.expiresAt && physical.expiresAt <= new Date()) {
        throw new ServiceUnavailableException('Segredo fisico expirado');
      }

      if (grant.operation !== IntegrationBreakGlassOperation.PROVIDER_VERIFY) {
        throw new ServiceUnavailableException(
          'Operacao break-glass sem handler governado',
        );
      }

      const usedAt = new Date();
      const touched = await this.prisma.integrationConnection.updateMany({
        where: {
          id: connection.id,
          secretReference: connection.secretReference,
          secretVersion: connection.secretVersion,
          secretRevokedAt: null,
          OR: [
            { secretExpiresAt: null },
            { secretExpiresAt: { gt: usedAt } },
          ],
        },
        data: {
          secretLastUsedAt: usedAt,
        },
      });
      if (touched.count !== 1) {
        throw new ServiceUnavailableException(
          'Credencial mudou, expirou ou foi revogada durante break-glass',
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
          connection.publicConfiguration
          && typeof connection.publicConfiguration === 'object'
          && !Array.isArray(connection.publicConfiguration)
            ? connection.publicConfiguration as Record<string, unknown>
            : null,
        secret: new IntegrationSecretValue(physical.value),
      });

      const consumedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        const consumed = await tx.integrationBreakGlassGrant.updateMany({
          where: {
            id: grant.id,
            status: IntegrationBreakGlassStatus.EXECUTING,
          },
          data: {
            status: IntegrationBreakGlassStatus.CONSUMED,
            consumedAt,
          },
        });
        if (consumed.count !== 1) {
          throw new ConflictException(
            'Break-glass mudou durante consumo',
          );
        }

        const verified = await tx.integrationConnection.updateMany({
          where: {
            id: connection.id,
            secretReference: connection.secretReference,
            secretVersion: connection.secretVersion,
            secretRevokedAt: null,
          },
          data: {
            lastVerifiedAt: consumedAt,
          },
        });
        if (verified.count !== 1) {
          throw new ConflictException(
            'Credencial mudou durante conclusao do break-glass',
          );
        }

        await this.audit.record(
          {
            gymId: connection.gymId,
            userId,
            action: 'INTEGRATION_BREAK_GLASS_CONSUMED',
            entity: 'IntegrationBreakGlassGrant',
            entityId: grant.id,
            next: {
              connectionId: connection.id,
              providerCode: connection.providerCode,
              operation: grant.operation,
              consumedAt,
            },
          },
          tx,
        );
      });

      return {
        id: grant.id,
        operation: grant.operation,
        status: IntegrationBreakGlassStatus.CONSUMED,
        executed: true,
        consumedAt,
      };
    } catch (error) {
      const failedAt = new Date();
      await this.prisma.integrationBreakGlassGrant.updateMany({
        where: {
          id: grant.id,
          status: IntegrationBreakGlassStatus.EXECUTING,
        },
        data: {
          status: IntegrationBreakGlassStatus.FAILED,
          failedAt,
        },
      });
      await this.audit.record({
        gymId: connection.gymId,
        userId,
        action: 'INTEGRATION_BREAK_GLASS_FAILED',
        entity: 'IntegrationBreakGlassGrant',
        entityId: grant.id,
        next: {
          connectionId: connection.id,
          providerCode: connection.providerCode,
          operation: grant.operation,
          failedAt,
          errorCode: 'GOVERNED_OPERATION_FAILED',
        },
      });
      throw error;
    }
  }

  async revoke(
    grantId: string,
    userId: string,
    dto: IntegrationBreakGlassRevokeDto,
  ) {
    await this.assertBreakGlassStepUp(userId, dto);
    await this.expireStale();
    const reason = this.assertSafeReason(dto.reason);

    const grant = await this.prisma.integrationBreakGlassGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw new NotFoundException('Break-glass request inexistente');

    const connection = await this.requireConnection(
      grant.integrationConnectionId,
    );
    const revokedAt = new Date();

    const changed = await this.prisma.integrationBreakGlassGrant.updateMany({
      where: {
        id: grant.id,
        status: {
          in: [
            IntegrationBreakGlassStatus.REQUESTED,
            IntegrationBreakGlassStatus.APPROVED,
          ],
        },
      },
      data: {
        status: IntegrationBreakGlassStatus.REVOKED,
        revokedAt,
      },
    });
    if (changed.count !== 1) {
      throw new ConflictException(
        'Break-glass nao pode mais ser revogado',
      );
    }

    await this.audit.record({
      gymId: connection.gymId,
      userId,
      action: 'INTEGRATION_BREAK_GLASS_REVOKED',
      entity: 'IntegrationBreakGlassGrant',
      entityId: grant.id,
      next: {
        connectionId: connection.id,
        providerCode: connection.providerCode,
        revokedAt,
        revokeReason: reason,
      },
    });

    const revoked = await this.prisma.integrationBreakGlassGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    return this.safeView(revoked, connection.providerCode);
  }
}
