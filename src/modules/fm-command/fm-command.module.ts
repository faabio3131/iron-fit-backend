import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { AiModule } from '../ai/ai.module';
import { FmCommandControlPlaneController } from './fm-command-control-plane.controller';
import { FmCommandPlanGovernanceController } from './fm-command-plan-governance.controller';
import { FmCommandLegacyLimitController } from './fm-command-legacy-limit.controller';
import { FmCommandPlanGovernanceGuard } from './fm-command-plan-governance.guard';
import { FmCommandControlPlaneGuard } from './fm-command-control-plane.guard';
import { FmCommandControlPlaneService } from './fm-command-control-plane.service';

@Module({
  imports: [PrismaModule, ProductEntitlementsModule, AiModule],
  controllers: [FmCommandControlPlaneController, FmCommandPlanGovernanceController, FmCommandLegacyLimitController],
  providers: [
    FmCommandControlPlaneGuard,
    FmCommandPlanGovernanceGuard,
    FmCommandControlPlaneService,
    AuditService,
  ],
})
export class FmCommandModule {}
