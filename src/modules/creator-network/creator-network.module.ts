import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentCatalogController } from './content-catalog.controller';
import { ContentCatalogService } from './content-catalog.service';
import { CreatorRegistryController } from './creator-registry.controller';
import { CreatorRegistryService } from './creator-registry.service';
import { MediaIngestionController } from './media-ingestion.controller';
import { MediaIngestionService } from './media-ingestion.service';
import { CreatorMediaProviderRegistry } from './media/media-provider.registry';
import { RightsVaultController } from './rights-vault.controller';
import { RightsVaultService } from './rights-vault.service';

@Module({
  controllers: [
    CreatorRegistryController,
    RightsVaultController,
    ContentCatalogController,
    MediaIngestionController,
  ],
  providers: [
    CreatorRegistryService,
    RightsVaultService,
    ContentCatalogService,
    MediaIngestionService,
    CreatorMediaProviderRegistry,
    PrismaService,
    AuditService,
  ],
  exports: [
    CreatorRegistryService,
    RightsVaultService,
    ContentCatalogService,
    MediaIngestionService,
    CreatorMediaProviderRegistry,
  ],
})
export class CreatorNetworkModule {}
