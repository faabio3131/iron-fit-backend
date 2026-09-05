import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class SetProductConfigurationDto {
  @IsIn(['FEATURE', 'LIMIT', 'POLICY'])
  kind: 'FEATURE' | 'LIMIT' | 'POLICY';

  @IsOptional()
  @IsBoolean()
  featureEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  limitValue?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(32)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/, { each: true })
  policyValues?: string[];
}
