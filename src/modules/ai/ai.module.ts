import { Module, OnModuleInit } from '@nestjs/common';
import { OpenAiCompatibleProviderAdapter, GeminiNativeProviderAdapter } from './providers/external-ai-provider.adapters';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CreatorNetworkModule } from '../creator-network/creator-network.module';
import { EquipmentsModule } from '../equipments/equipments.module';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AuthModule } from '../auth/auth.module';
import { AiConfigurationAdminController } from './configuration/ai-configuration-admin.controller';
import { AiConfigurationAdminService } from './configuration/ai-configuration-admin.service';
import { AiController } from './ai.controller';
import { AiMobileAdvisoryService } from './ai-mobile-advisory.service';
import { AiPersistenceService } from './ai-persistence.service';
import { AiWorkoutCandidateController } from './ai-workout-candidate.controller';
import { AiWorkoutCandidateService } from './ai-workout-candidate.service';
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
  imports: [
    PrismaModule,
    AuthModule,
    ProductEntitlementsModule,
    EquipmentsModule,
    CreatorNetworkModule,
    WorkoutsModule,
    IntegrationsModule,
  ],
  controllers: [AiController, AiWorkoutCandidateController, AiConfigurationAdminController],
  providers: [
    AuditService,
    AiPersistenceService,
    AiSanitizerService,
    AiContextBuilderService,
    AiPolicyGuardService,
    AiOutputValidatorService,
    AiConfigurationResolverService,
    AiConfigurationAdminService,
    NullAiProviderAdapter,
    OpenAiCompatibleProviderAdapter,
    GeminiNativeProviderAdapter,
    AiProviderRegistryService,
    AiSecretReferenceService,
    AiProviderExecutionService,
    AiMobileAdvisoryService,
    AiWorkoutCandidateService,
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
export class AiModule implements OnModuleInit {
  constructor(
    private readonly registry: AiProviderRegistryService,
    private readonly openaiCompatible: OpenAiCompatibleProviderAdapter,
    private readonly gemini: GeminiNativeProviderAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.openaiCompatible);
    this.registry.register(this.gemini);
  }
}
