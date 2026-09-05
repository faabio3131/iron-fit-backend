import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductEntitlementsController } from './product-entitlements.controller';
import { ProductEntitlementsService } from './product-entitlements.service';
import { TenantProductEntitlementsController } from './tenant-product-entitlements.controller';
import { TenantProductEntitlementsService } from './tenant-product-entitlements.service';
import { TenantProductSubscriptionLifecycleController } from './tenant-product-subscription-lifecycle.controller';
import { TenantProductSubscriptionLifecycleService } from './tenant-product-subscription-lifecycle.service';

@Module({
  controllers: [
    ProductEntitlementsController,
    TenantProductEntitlementsController,
    TenantProductSubscriptionLifecycleController,
  ],
  providers: [
    ProductEntitlementsService,
    TenantProductEntitlementsService,
    TenantProductSubscriptionLifecycleService,
    PrismaService,
    AuditService,
  ],
  exports: [
    ProductEntitlementsService,
    TenantProductEntitlementsService,
    TenantProductSubscriptionLifecycleService,
  ],
})
export class ProductEntitlementsModule {}
