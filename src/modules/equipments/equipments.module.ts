import { Module } from '@nestjs/common';
import { EquipmentsController } from './equipments.controller';
import { EquipmentsService } from './equipments.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditService } from '../../common/audit/audit.service';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';

@Module({
  imports: [PrismaModule, ProductEntitlementsModule],
  controllers: [EquipmentsController],
  providers: [EquipmentsService, AuditService],
  exports: [EquipmentsService],
})
export class EquipmentsModule {}
