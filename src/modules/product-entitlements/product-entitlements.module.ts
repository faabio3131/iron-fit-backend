import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ProductEntitlementsController } from './product-entitlements.controller';
import { ProductEntitlementsService } from './product-entitlements.service';

@Module({
  controllers: [ProductEntitlementsController],
  providers: [ProductEntitlementsService, PrismaService, AuditService],
  exports: [ProductEntitlementsService],
})
export class ProductEntitlementsModule {}
