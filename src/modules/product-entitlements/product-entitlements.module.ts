import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductEntitlementsController } from './product-entitlements.controller';
import { ProductEntitlementsService } from './product-entitlements.service';
import { TenantProductConfigurationController } from './tenant-product-configuration.controller';
import { TenantProductConfigurationService } from './tenant-product-configuration.service';
import { TenantProductEntitlementsController } from './tenant-product-entitlements.controller';
import { TenantProductEntitlementsService } from './tenant-product-entitlements.service';

@Module({
  controllers: [
    ProductEntitlementsController,
    TenantProductEntitlementsController,
    TenantProductConfigurationController,
  ],
  providers: [
    ProductEntitlementsService,
    TenantProductEntitlementsService,
    TenantProductConfigurationService,
    PrismaService,
    AuditService,
  ],
  exports: [
    ProductEntitlementsService,
    TenantProductEntitlementsService,
    TenantProductConfigurationService,
  ],
})
export class ProductEntitlementsModule {}
