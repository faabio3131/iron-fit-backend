import { IsIn, IsObject, IsOptional } from 'class-validator';

export const COMMERCIAL_ONBOARDING_STEPS = [
  'ACADEMY_PROFILE',
  'EQUIPMENT_INVENTORY',
  'TEAM_REVIEW',
  'FINISH',
] as const;

export type CommercialOnboardingStep = (typeof COMMERCIAL_ONBOARDING_STEPS)[number];

export class UpdateOnboardingDto {
  @IsIn(COMMERCIAL_ONBOARDING_STEPS)
  step!: CommercialOnboardingStep;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
