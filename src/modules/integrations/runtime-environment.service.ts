import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseIronRuntimeEnvironment } from '../../common/runtime/iron-runtime-environment';
import { IntegrationEnvironmentContract } from './contracts/integration-contract';

@Injectable()
export class IntegrationRuntimeEnvironmentService {
  constructor(private readonly config: ConfigService) {}

  current(): IntegrationEnvironmentContract {
    const value = parseIronRuntimeEnvironment(
      this.config.get<string>('IRON_RUNTIME_ENV'),
    );
    if (!value) {
      throw new ServiceUnavailableException(
        'IRON_RUNTIME_ENV deve ser DEV, HOMOLOG ou PROD',
      );
    }
    return value as IntegrationEnvironmentContract;
  }
}
