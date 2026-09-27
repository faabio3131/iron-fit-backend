import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { CommercialLaunchController } from './commercial-launch.controller';
import { CommercialLaunchService } from './commercial-launch.service';
import { CommercialRuntimePolicyService } from './commercial-runtime-policy.service';

@Module({
  imports: [AuthModule, ProductEntitlementsModule],
  controllers: [CommercialLaunchController],
  providers: [
    PrismaService,
    AuditService,
    CommercialLaunchService,
    CommercialRuntimePolicyService,
  ],
  exports: [CommercialLaunchService, CommercialRuntimePolicyService],
})
export class CommercialLaunchModule {}
