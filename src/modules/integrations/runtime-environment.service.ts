import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  INTEGRATION_ENVIRONMENTS,
  IntegrationEnvironmentContract,
} from './contracts/integration-contract';

@Injectable()
export class IntegrationRuntimeEnvironmentService {
  constructor(private readonly config: ConfigService) {}

  current(): IntegrationEnvironmentContract {
    const value = this.config.get<string>('IRON_RUNTIME_ENV')?.trim().toUpperCase();
    if (!value || !INTEGRATION_ENVIRONMENTS.includes(value as IntegrationEnvironmentContract)) {
      throw new ServiceUnavailableException(
        'IRON_RUNTIME_ENV deve ser DEV, HOMOLOG ou PROD',
      );
    }
    return value as IntegrationEnvironmentContract;
  }
}
