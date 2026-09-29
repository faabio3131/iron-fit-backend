import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { CommercialLaunchController } from './commercial-launch.controller';
import { CommercialLaunchService } from './commercial-launch.service';

@Module({
  imports: [PrismaModule, AuthModule, ProductEntitlementsModule],
  controllers: [CommercialLaunchController],
  providers: [
    AuditService,
    CommercialLaunchService,
  ],
  exports: [CommercialLaunchService],
})
export class CommercialLaunchModule {}
