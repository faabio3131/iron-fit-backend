import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductEntitlementsController } from './product-entitlements.controller';
import { ProductCapabilitiesController } from './product-capabilities.controller';
import { ProductCapabilityCatalogService } from './product-capability-catalog.service';
import { ProductEntitlementsService } from './product-entitlements.service';
import { TenantProductEntitlementsController } from './tenant-product-entitlements.controller';
import { TenantProductEntitlementsService } from './tenant-product-entitlements.service';
import { TenantProductSubscriptionLifecycleController } from './tenant-product-subscription-lifecycle.controller';
import { TenantProductSubscriptionLifecycleService } from './tenant-product-subscription-lifecycle.service';

@Module({
  controllers: [
    ProductCapabilitiesController,
    ProductEntitlementsController,
    TenantProductEntitlementsController,
    TenantProductSubscriptionLifecycleController,
  ],
  providers: [
    ProductCapabilityCatalogService,
    ProductEntitlementsService,
    TenantProductEntitlementsService,
    TenantProductSubscriptionLifecycleService,
    PrismaService,
    AuditService,
  ],
  exports: [
    ProductCapabilityCatalogService,
    ProductEntitlementsService,
    TenantProductEntitlementsService,
    TenantProductSubscriptionLifecycleService,
  ],
})
export class ProductEntitlementsModule {}
