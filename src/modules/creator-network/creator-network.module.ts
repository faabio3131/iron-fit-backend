import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { ContentCatalogController } from './content-catalog.controller';
import { ContentCatalogService } from './content-catalog.service';
import { ContentLifecycleController } from './content-lifecycle.controller';
import { ContentLifecycleService } from './content-lifecycle.service';
import { ContentUsageService } from './content-usage.service';
import { CreatorAnalyticsService } from './creator-analytics.service';
import { CreatorCommercialController } from './creator-commercial.controller';
import { CreatorCommercialService } from './creator-commercial.service';
import { CreatorOperationsConsoleService } from './creator-operations-console.service';
import { CreatorOperationsController } from './creator-operations.controller';
import { CreatorRegistryController } from './creator-registry.controller';
import { CreatorRegistryService } from './creator-registry.service';
import { ExerciseContentPublishingController } from './exercise-content-publishing.controller';
import { ExerciseContentPublishingService } from './exercise-content-publishing.service';
import { MediaIngestionController } from './media-ingestion.controller';
import { MediaIngestionService } from './media-ingestion.service';
import { CreatorMediaProviderRegistry } from './media/media-provider.registry';
import { RightsVaultController } from './rights-vault.controller';
import { RightsVaultService } from './rights-vault.service';

@Module({
  imports: [PrismaModule, ProductEntitlementsModule],
  controllers: [
    CreatorRegistryController,
    RightsVaultController,
    ContentCatalogController,
    MediaIngestionController,
    ExerciseContentPublishingController,
    ContentLifecycleController,
    CreatorCommercialController,
    CreatorOperationsController,
  ],
  providers: [
    CreatorRegistryService,
    RightsVaultService,
    ContentCatalogService,
    MediaIngestionService,
    ExerciseContentPublishingService,
    ContentLifecycleService,
    ContentUsageService,
    CreatorCommercialService,
    CreatorOperationsConsoleService,
    CreatorAnalyticsService,
    CreatorMediaProviderRegistry,
    AuditService,
  ],
  exports: [
    CreatorRegistryService,
    RightsVaultService,
    ContentCatalogService,
    MediaIngestionService,
    ExerciseContentPublishingService,
    ContentLifecycleService,
    ContentUsageService,
    CreatorCommercialService,
    CreatorOperationsConsoleService,
    CreatorAnalyticsService,
    CreatorMediaProviderRegistry,
  ],
})
export class CreatorNetworkModule {}
