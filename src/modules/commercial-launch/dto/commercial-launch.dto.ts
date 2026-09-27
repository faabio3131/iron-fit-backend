import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { StepUpDto } from '../../auth/dto/identity-security.dto';

export const LAUNCH_DECISIONS = [
  'UNDECIDED',
  'LAUNCH',
  'EXTERNAL_BLOCKER',
  'OUT',
] as const;

export const LAUNCH_ITEM_KINDS = [
  'SURFACE',
  'CHANNEL',
  'PROVIDER',
  'CAPABILITY',
  'MOBILE',
] as const;

export class CreateCommercialLaunchMatrixDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;
}

export class UpsertCommercialLaunchItemDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]{2,95}$/)
  itemKey!: string;

  @IsString()
  @IsIn(LAUNCH_ITEM_KINDS)
  kind!: (typeof LAUNCH_ITEM_KINDS)[number];

  @IsString()
  @IsIn(LAUNCH_DECISIONS)
  decision!: (typeof LAUNCH_DECISIONS)[number];

  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/)
  featureKey?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  rationale?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  blockerOwner?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  evidenceRequirement?: string;
}

export class AddCommercialLaunchOfferingDto {
  @IsUUID()
  priceId!: string;
}

export class SetCommercialLaunchPolicyDto {
  @IsBoolean()
  trialEnabled!: boolean;

  @IsOptional()
  @IsUUID()
  trialPlanVersionId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  trialDays?: number;

  @IsInt()
  @Min(0)
  @Max(30)
  invoiceDueDays!: number;

  @IsInt()
  @Min(1)
  @Max(30)
  dunningGraceDays!: number;

  @IsString()
  @IsIn(['IMMEDIATE_PRORATED'])
  upgradePolicy!: 'IMMEDIATE_PRORATED';

  @IsString()
  @IsIn(['NEXT_PERIOD_NO_IMMEDIATE_REFUND'])
  downgradePolicy!: 'NEXT_PERIOD_NO_IMMEDIATE_REFUND';

  @IsString()
  @IsIn(['IMMEDIATE_OR_PERIOD_END'])
  cancellationPolicy!: 'IMMEDIATE_OR_PERIOD_END';

  @IsString()
  @IsIn(['SUPER_ADMIN_MANUAL'])
  refundPolicy!: 'SUPER_ADMIN_MANUAL';

  @IsString()
  @IsIn(['UNDECIDED', 'PROVIDER_NFSE', 'EXTERNAL_HANDOFF', 'OUT'])
  fiscalMode!: 'UNDECIDED' | 'PROVIDER_NFSE' | 'EXTERNAL_HANDOFF' | 'OUT';
}

export class ApproveCommercialLaunchMatrixDto extends StepUpDto {
  @IsString()
  @IsIn(['APPROVE_LAUNCH_MATRIX'])
  confirmation!: 'APPROVE_LAUNCH_MATRIX';
}
