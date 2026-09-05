import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class SetProductPlanEntitlementDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/)
  @MaxLength(160)
  featureKey: string;

  @IsBoolean()
  @IsOptional()
  featureEnabled?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  limitValue?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @IsOptional()
  policyValues?: string[];
}
