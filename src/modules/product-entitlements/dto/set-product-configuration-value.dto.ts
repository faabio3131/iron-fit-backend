import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class SetProductConfigurationValueDto {
  @IsOptional()
  @IsBoolean()
  featureEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  limitValue?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  policyValues?: string[];
}
