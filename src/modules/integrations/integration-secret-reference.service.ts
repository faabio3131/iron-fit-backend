import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IntegrationConnection,
  IntegrationEnvironment,
  IntegrationScope,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

@Injectable()
export class IntegrationSecretReferenceService {
  constructor(private readonly config: ConfigService) {}

  newReferenceId() {
    return randomUUID();
  }

  runtimeEnvironment(): IntegrationEnvironment {
    const configured = this.config
      .get<string>('INTEGRATION_RUNTIME_ENV')
      ?.trim()
      .toUpperCase();

    if (
      configured === IntegrationEnvironment.DEV ||
      configured === IntegrationEnvironment.HOMOLOG ||
      configured === IntegrationEnvironment.PROD
    ) {
      return configured;
    }

    const nodeEnv = this.config.get<string>('NODE_ENV')?.trim();
    if (nodeEnv === 'test' || nodeEnv === 'development') {
      return IntegrationEnvironment.DEV;
    }

    throw new ServiceUnavailableException(
      'INTEGRATION_RUNTIME_ENV ausente ou invalido',
    );
  }

  assertRuntimeEnvironment(environment: IntegrationEnvironment) {
    if (environment !== this.runtimeEnvironment()) {
      throw new ServiceUnavailableException(
        'integracao pertence a outro ambiente de runtime',
      );
    }
  }

  path(
    connection: Pick<
      IntegrationConnection,
      'id' | 'scope' | 'gymId' | 'environment'
    >,
    referenceId: string,
  ) {
    this.assertRuntimeEnvironment(connection.environment);

    const tenantSegment =
      connection.scope === IntegrationScope.GLOBAL
        ? 'global'
        : connection.gymId;

    if (!tenantSegment || !SEGMENT_PATTERN.test(tenantSegment)) {
      throw new ServiceUnavailableException(
        'escopo tenant da integracao invalido',
      );
    }
    if (!SEGMENT_PATTERN.test(connection.id)) {
      throw new ServiceUnavailableException('connection id invalido');
    }
    if (!SEGMENT_PATTERN.test(referenceId)) {
      throw new ServiceUnavailableException('secret reference invalida');
    }

    return [
      'iron-fit',
      connection.environment.toLowerCase(),
      connection.scope.toLowerCase(),
      tenantSegment,
      connection.id,
      referenceId,
    ].join('/');
  }
}
