import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatorNetworkModule } from '../creator-network/creator-network.module';
import { EquipmentsModule } from '../equipments/equipments.module';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { AiContextBuilderService } from './context/ai-context-builder.service';
import { AiPersistenceService } from './ai-persistence.service';
import { AiPolicyGuardService } from './policy/ai-policy-guard.service';
import { AiSanitizerService } from './security/ai-sanitizer.service';
import { AiOutputValidatorService } from './validation/ai-output-validator.service';

@Module({
  imports: [ProductEntitlementsModule, EquipmentsModule, CreatorNetworkModule],
  providers: [
    PrismaService,
    AuditService,
    AiPersistenceService,
    AiSanitizerService,
    AiContextBuilderService,
    AiPolicyGuardService,
    AiOutputValidatorService,
  ],
  exports: [
    AiPersistenceService,
    AiSanitizerService,
    AiContextBuilderService,
    AiPolicyGuardService,
    AiOutputValidatorService,
  ],
})
export class AiModule {}
