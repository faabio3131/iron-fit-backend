import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IntegrationEnvironment, IntegrationScope } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertCapability,
  assertIntegrationScope,
  assertPublicIntegrationConfiguration,
  assertProviderCode,
  CreateIntegrationConnectionCommand,
  IntegrationConnectionScope,
} from './contracts/integration-contract';
import { IntegrationProviderRegistry } from './provider-registry.service';

@Injectable()
export class IntegrationConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: IntegrationProviderRegistry,
  ) {}

  async create(command: CreateIntegrationConnectionCommand) {
    assertIntegrationScope(command);
    assertPublicIntegrationConfiguration(command.publicConfiguration);

    const providerCode = assertProviderCode(command.providerCode);
    const provider = this.providers.require(providerCode);

    if (!provider.environments.includes(command.environment)) {
      throw new BadRequestException('Provider nao homologado para este environment');
    }
    if (!provider.authModels.includes(command.authModel)) {
      throw new BadRequestException('authModel nao suportado pelo provider');
    }

    const capabilities = [...new Set(command.capabilities.map(assertCapability))];
    if (capabilities.length === 0) throw new BadRequestException('Conexao exige ao menos uma capability');
    for (const capability of capabilities) {
      if (!provider.capabilities.includes(capability)) {
        throw new BadRequestException('Capability ' + capability + ' nao suportada pelo provider');
      }
    }

    return this.prisma.integrationConnection.create({
      data: {
        scope: command.scope as IntegrationScope,
        gymId: command.scope === 'TENANT' ? command.gymId!.trim() : null,
        providerCode,
        environment: command.environment as IntegrationEnvironment,
        authModel: command.authModel,
        capabilities,
        publicConfiguration: command.publicConfiguration
          ? JSON.parse(JSON.stringify(command.publicConfiguration))
          : undefined,
        createdByUserId: command.createdByUserId?.trim() || null,
      },
    });
  }

  async findScopedById(connectionId: string, scope: IntegrationConnectionScope) {
    assertIntegrationScope(scope);
    const connection = await this.prisma.integrationConnection.findFirst({
      where: {
        id: connectionId,
        scope: scope.scope as IntegrationScope,
        gymId: scope.scope === 'TENANT' ? scope.gymId!.trim() : null,
      },
    });
    if (!connection) throw new NotFoundException('Integration connection nao encontrada no escopo ativo');
    return connection;
  }
}
