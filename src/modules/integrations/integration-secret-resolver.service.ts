import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationConnectionStatus,
  IntegrationScope,
  IntegrationSecretStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IntegrationSecretPayload,
  IntegrationVaultPort,
  INTEGRATION_VAULT,
} from './contracts/integration-vault.port';
import { IntegrationSecretReferenceService } from './integration-secret-reference.service';

export interface IntegrationSecretResolutionContext {
  scope: IntegrationScope;
  gymId: string | null;
}

@Injectable()
export class IntegrationSecretResolverService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(INTEGRATION_VAULT)
    private readonly vault: IntegrationVaultPort,
    private readonly references: IntegrationSecretReferenceService,
  ) {}

  private async snapshot(
    connectionId: string,
    context: IntegrationSecretResolutionContext,
    runtime: boolean,
  ) {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { id: connectionId },
      include: {
        secretVersions: {
          where: { status: IntegrationSecretStatus.ACTIVE },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!connection) {
      throw new ServiceUnavailableException('integracao indisponivel');
    }

    if (
      connection.scope !== context.scope ||
      connection.gymId !== context.gymId
    ) {
      throw new ForbiddenException('integracao fora do escopo autorizado');
    }

    this.references.assertRuntimeEnvironment(connection.environment);

    if (connection.status === IntegrationConnectionStatus.REVOKED) {
      throw new ServiceUnavailableException('integracao revogada');
    }
    if (runtime && connection.status !== IntegrationConnectionStatus.ACTIVE) {
      throw new ServiceUnavailableException(
        'integracao ainda nao esta ACTIVE',
      );
    }

    const secret = connection.secretVersions[0];
    if (!secret || secret.revokedAt) {
      throw new ServiceUnavailableException(
        'credencial de integracao indisponivel',
      );
    }

    if (secret.expiresAt && secret.expiresAt <= new Date()) {
      await this.prisma.integrationSecretVersion.updateMany({
        where: {
          id: secret.id,
          status: IntegrationSecretStatus.ACTIVE,
        },
        data: { status: IntegrationSecretStatus.EXPIRED },
      });
      throw new ServiceUnavailableException(
        'credencial de integracao expirada',
      );
    }

    return { connection, secret };
  }

  private async resolve(
    connectionId: string,
    context: IntegrationSecretResolutionContext,
    runtime: boolean,
    verification: boolean,
  ): Promise<IntegrationSecretPayload> {
    const { connection, secret } = await this.snapshot(
      connectionId,
      context,
      runtime,
    );
    const referencePath = this.references.path(connection, secret.referenceId);
    const payload = await this.vault.get(referencePath);
    const now = new Date();

    await this.prisma.integrationSecretVersion.updateMany({
      where: {
        id: secret.id,
        status: IntegrationSecretStatus.ACTIVE,
      },
      data: verification
        ? { lastVerifiedAt: now, lastUsedAt: now }
        : { lastUsedAt: now },
    });

    return payload;
  }

  resolveForVerification(
    connectionId: string,
    context: IntegrationSecretResolutionContext,
  ) {
    return this.resolve(connectionId, context, false, true);
  }

  resolveForRuntime(
    connectionId: string,
    context: IntegrationSecretResolutionContext,
  ) {
    return this.resolve(connectionId, context, true, false);
  }
}
