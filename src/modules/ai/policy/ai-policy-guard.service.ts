import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantProductEntitlementsService } from '../../product-entitlements/tenant-product-entitlements.service';
import { AiCapability } from '../contracts/ai-contract';

const CAPABILITY_FEATURE_KEY: Record<AiCapability, string> = {
  WORKOUT_INSIGHTS: 'ai.content_recommendation',
  ADVISORY_CHAT: 'ai.content_recommendation',
  CONTENT_RECOMMENDATION: 'ai.content_recommendation',
  WORKOUT_GENERATION: 'ai.workout_generation',
};

const CAPABILITY_PURPOSE: Record<AiCapability, string> = {
  WORKOUT_INSIGHTS: 'student_workout_insights',
  ADVISORY_CHAT: 'student_advisory_chat',
  CONTENT_RECOMMENDATION: 'content_recommendation',
  WORKOUT_GENERATION: 'workout_candidate_generation',
};

export interface AiPolicyContext {
  gymId: string;
  userId: string;
  capability: AiCapability;
  purpose: string;
  isStudent: boolean;
}

@Injectable()
export class AiPolicyGuardService {
  constructor(private readonly entitlements: TenantProductEntitlementsService) {}

  async assertAllowed(context: AiPolicyContext) {
    if (!context.gymId?.trim() || !context.userId?.trim()) {
      throw new ForbiddenException('AI policy exige identidade e tenant autenticados');
    }
    const expectedPurpose = CAPABILITY_PURPOSE[context.capability];
    if (context.purpose !== expectedPurpose) {
      throw new ForbiddenException('Finalidade AI nao autorizada para a capability');
    }

    const featureKey = CAPABILITY_FEATURE_KEY[context.capability];
    const resolution = context.isStudent
      ? await this.entitlements.resolveFeatureForUser(
          context.gymId,
          context.userId,
          featureKey,
        )
      : await this.entitlements.resolveFeature(context.gymId, featureKey);

    if (resolution.value !== true) {
      throw new ForbiddenException('Capability AI nao autorizada pelo entitlement efetivo');
    }

    return {
      capability: context.capability,
      purpose: context.purpose,
      featureKey,
      allowed: true as const,
      resolution,
    };
  }
}
