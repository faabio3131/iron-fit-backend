import {
  IsISO8601,
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

const SHA256 = /^[0-9a-f]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;

export class RegisterCommercialAgreementDto {
  @IsUUID()
  contentId!: string;

  @IsUUID()
  beneficiaryRightsHolderId!: string;

  @Matches(CURRENCY)
  currency!: string;
}

export class CreateCommercialRuleVersionDto {
  @IsIn(['FIXED_PER_EVENT', 'REVENUE_SHARE_BPS'])
  compensationMode!: 'FIXED_PER_EVENT' | 'REVENUE_SHARE_BPS';

  @IsIn(['DELIVERY_RESOLVED', 'CONTENT_OPENED', 'CONTENT_COMPLETED'])
  qualifyingEventType!: 'DELIVERY_RESOLVED' | 'CONTENT_OPENED' | 'CONTENT_COMPLETED';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  fixedAmountMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  revenueShareBps?: number;

  @IsISO8601({ strict: true })
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveUntil?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(512)
  termsReference!: string;

  @Matches(SHA256)
  termsSha256!: string;
}

export class CommercialRuleReasonDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class AccrueUsageEventDto {
  @IsUUID()
  agreementId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  eligibleRevenueMinor?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  revenueSourceType?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  revenueSourceId?: string;

  @IsOptional()
  @Matches(SHA256)
  revenueEvidenceSha256?: string;
}

export class CreateCreatorSettlementDto {
  @IsUUID()
  beneficiaryRightsHolderId!: string;

  @Matches(CURRENCY)
  currency!: string;

  @IsUUID()
  settlementKey!: string;

  @IsISO8601({ strict: true })
  periodStart!: string;

  @IsISO8601({ strict: true })
  periodEnd!: string;
}

export class MarkCreatorSettlementSettledDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  settlementProvider!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalSettlementId!: string;

  @Matches(SHA256)
  settlementEvidenceSha256!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  settledAt?: string;
}
