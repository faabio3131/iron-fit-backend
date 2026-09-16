import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatorNetworkModule } from '../creator-network/creator-network.module';
import { EquipmentsModule } from '../equipments/equipments.module';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { AiController } from './ai.controller';
import { AiMobileAdvisoryService } from './ai-mobile-advisory.service';
import { AiPersistenceService } from './ai-persistence.service';
import { AiConfigurationResolverService } from './configuration/ai-configuration-resolver.service';
import { AiContextBuilderService } from './context/ai-context-builder.service';
import { AiPolicyGuardService } from './policy/ai-policy-guard.service';
import { AiProviderRegistryService } from './providers/ai-provider-registry.service';
import { NullAiProviderAdapter } from './providers/null-ai-provider.adapter';
import { AiProviderExecutionService } from './runtime/ai-provider-execution.service';
import { AiSanitizerService } from './security/ai-sanitizer.service';
import { AiSecretReferenceService } from './secrets/ai-secret-reference.service';
import { AiOutputValidatorService } from './validation/ai-output-validator.service';

@Module({
  imports: [ProductEntitlementsModule, EquipmentsModule, CreatorNetworkModule],
  controllers: [AiController],
  providers: [
    PrismaService,
    AuditService,
    AiPersistenceService,
    AiSanitizerService,
    AiContextBuilderService,
    AiPolicyGuardService,
    AiOutputValidatorService,
    AiConfigurationResolverService,
    NullAiProviderAdapter,
    AiProviderRegistryService,
    AiSecretReferenceService,
    AiProviderExecutionService,
    AiMobileAdvisoryService,
  ],
  exports: [
    AiPersistenceService,
    AiSanitizerService,
    AiContextBuilderService,
    AiPolicyGuardService,
    AiOutputValidatorService,
    AiConfigurationResolverService,
    AiProviderRegistryService,
    AiSecretReferenceService,
    AiProviderExecutionService,
  ],
})
export class AiModule {}
