import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatorRegistryController } from './creator-registry.controller';
import { CreatorRegistryService } from './creator-registry.service';
import { RightsVaultController } from './rights-vault.controller';
import { RightsVaultService } from './rights-vault.service';

@Module({
  controllers: [CreatorRegistryController, RightsVaultController],
  providers: [
    CreatorRegistryService,
    RightsVaultService,
    PrismaService,
    AuditService,
  ],
  exports: [CreatorRegistryService, RightsVaultService],
})
export class CreatorNetworkModule {}
