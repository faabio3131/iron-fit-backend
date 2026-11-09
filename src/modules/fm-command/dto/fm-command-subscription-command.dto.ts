import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class FmCommandSubscriptionCommandDto {
  @IsIn(['subscription.status.sync', 'subscription.plan.transition'])
  action: 'subscription.status.sync' | 'subscription.plan.transition';

  @IsUUID()
  gymId: string;

  @IsUUID()
  expectedSubscriptionId: string;

  @IsIn([
    'active',
    'grace',
    'delinquent',
    'suspended',
    'cancelled',
    'renewal',
    'upgrade',
    'downgrade',
  ])
  commercialStatus:
    | 'active'
    | 'grace'
    | 'delinquent'
    | 'suspended'
    | 'cancelled'
    | 'renewal'
    | 'upgrade'
    | 'downgrade';

  @IsIn(['ACTIVE', 'SUSPENDED', 'CANCELED'])
  @IsOptional()
  entitlementStatus?: 'ACTIVE' | 'SUSPENDED' | 'CANCELED';

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @IsOptional()
  planCode?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  planVersion?: number;

  @IsIn(['UPGRADE', 'DOWNGRADE', 'PLAN_CHANGE'])
  @IsOptional()
  transitionKind?: 'UPGRADE' | 'DOWNGRADE' | 'PLAN_CHANGE';

  @IsString()
  @MinLength(3)
  @MaxLength(256)
  reason: string;

  /** Expiration of the current paid license, computed by FM billing from real payment, not by IRON UI. */
  @IsISO8601({ strict: true })
  @IsOptional()
  paidThrough?: string;
}
