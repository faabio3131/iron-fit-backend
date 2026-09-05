import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductEntitlementsController } from './product-entitlements.controller';
import { ProductEntitlementsService } from './product-entitlements.service';
import { TenantProductEntitlementsController } from './tenant-product-entitlements.controller';
import { TenantProductEntitlementsService } from './tenant-product-entitlements.service';

@Module({
  controllers: [ProductEntitlementsController, TenantProductEntitlementsController],
  providers: [
    ProductEntitlementsService,
    TenantProductEntitlementsService,
    PrismaService,
    AuditService,
  ],
  exports: [ProductEntitlementsService, TenantProductEntitlementsService],
})
export class ProductEntitlementsModule {}
