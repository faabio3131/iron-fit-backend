import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IntegrationConnectionStatus, IntegrationEnvironment, IntegrationScope } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  assertIntegrationScope,
  assertIntegrationSecretReference,
  IntegrationConnectionScope,
} from '../contracts/integration-contract';
import { IntegrationRuntimeEnvironmentService } from '../runtime-environment.service';
import {
  INTEGRATION_SECRET_VAULT,
  IntegrationSecretValue,
  IntegrationSecretVaultPort,
} from './integration-secret-vault.port';

@Injectable()
export class IntegrationSecretResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtimeEnvironment: IntegrationRuntimeEnvironmentService,
    @Inject(INTEGRATION_SECRET_VAULT)
    private readonly vault: IntegrationSecretVaultPort,
  ) {}

  async resolveForExternalBoundary(
    connectionId: string,
    scope: IntegrationConnectionScope,
  ): Promise<IntegrationSecretValue> {
    assertIntegrationScope(scope);
    const runtimeEnvironment = this.runtimeEnvironment.current();
    const connection = await this.prisma.integrationConnection.findFirst({
      where: {
        id: connectionId,
        scope: scope.scope as IntegrationScope,
        gymId: scope.scope === 'TENANT' ? scope.gymId!.trim() : null,
        environment: runtimeEnvironment as IntegrationEnvironment,
      },
    });

    if (!connection) {
      throw new ServiceUnavailableException(
        'Integration connection indisponivel no escopo/ambiente ativo',
      );
    }
    if (connection.status !== IntegrationConnectionStatus.ACTIVE) {
      throw new ServiceUnavailableException('Integration connection nao esta ACTIVE');
    }
    if (!connection.secretReference || !connection.secretVersion || !connection.secretRotatedAt) {
      throw new ServiceUnavailableException('Integration connection sem segredo ativo');
    }
    if (connection.secretRevokedAt) {
      throw new ServiceUnavailableException('Credencial da integracao revogada');
    }
    if (connection.secretExpiresAt && connection.secretExpiresAt <= new Date()) {
      throw new ServiceUnavailableException('Credencial da integracao expirada');
    }

    const reference = assertIntegrationSecretReference(connection.secretReference);
    const snapshot = await this.vault.getSecret(reference);
    if (snapshot.version !== connection.secretVersion) {
      throw new ServiceUnavailableException('Versao do segredo diverge do estado canonico');
    }
    if (snapshot.expiresAt && snapshot.expiresAt <= new Date()) {
      throw new ServiceUnavailableException('Segredo fisico expirado');
    }

    const touch = await this.prisma.integrationConnection.updateMany({
      where: {
        id: connection.id,
        secretVersion: connection.secretVersion,
        secretRevokedAt: null,
        OR: [
          { secretExpiresAt: null },
          { secretExpiresAt: { gt: new Date() } },
        ],
      },
      data: { secretLastUsedAt: new Date() },
    });
    if (touch.count !== 1) {
      throw new ServiceUnavailableException(
        'Credencial mudou, expirou ou foi revogada durante a resolucao',
      );
    }

    return new IntegrationSecretValue(snapshot.value);
  }
}
