import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatorRegistryController } from './creator-registry.controller';
import { CreatorRegistryService } from './creator-registry.service';

@Module({
  controllers: [CreatorRegistryController],
  providers: [CreatorRegistryService, PrismaService, AuditService],
  exports: [CreatorRegistryService],
})
export class CreatorNetworkModule {}
