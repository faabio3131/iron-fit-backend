import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { FmCommandControlPlaneController } from './fm-command-control-plane.controller';
import { FmCommandControlPlaneGuard } from './fm-command-control-plane.guard';
import { FmCommandControlPlaneService } from './fm-command-control-plane.service';

@Module({
  imports: [PrismaModule, ProductEntitlementsModule],
  controllers: [FmCommandControlPlaneController],
  providers: [
    FmCommandControlPlaneGuard,
    FmCommandControlPlaneService,
    AuditService,
  ],
})
export class FmCommandModule {}
