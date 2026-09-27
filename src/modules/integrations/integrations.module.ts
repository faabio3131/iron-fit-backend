import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConnectionService } from './integration-connection.service';
import { IntegrationProviderRegistry } from './provider-registry.service';

@Module({
  providers: [PrismaService, IntegrationProviderRegistry, IntegrationConnectionService],
  exports: [IntegrationProviderRegistry, IntegrationConnectionService],
})
export class IntegrationsModule {}
