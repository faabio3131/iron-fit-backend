import { IsIn, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class TransitionTenantProductSubscriptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  gymId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  expectedCurrentSubscriptionId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  planCode: string;

  @IsInt()
  @Min(1)
  version: number;

  @IsIn(['UPGRADE', 'DOWNGRADE', 'PLAN_CHANGE'])
  transitionKind: 'UPGRADE' | 'DOWNGRADE' | 'PLAN_CHANGE';

  @IsString()
  @MinLength(3)
  @MaxLength(256)
  reason: string;
}
