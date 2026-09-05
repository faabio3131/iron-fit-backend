import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentCatalogController } from './content-catalog.controller';
import { ContentCatalogService } from './content-catalog.service';
import { CreatorRegistryController } from './creator-registry.controller';
import { CreatorRegistryService } from './creator-registry.service';
import { RightsVaultController } from './rights-vault.controller';
import { RightsVaultService } from './rights-vault.service';

@Module({
  controllers: [
    CreatorRegistryController,
    RightsVaultController,
    ContentCatalogController,
  ],
  providers: [
    CreatorRegistryService,
    RightsVaultService,
    ContentCatalogService,
    PrismaService,
    AuditService,
  ],
  exports: [CreatorRegistryService, RightsVaultService, ContentCatalogService],
})
export class CreatorNetworkModule {}
