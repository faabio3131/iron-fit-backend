import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProductCapabilityDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/)
  @MaxLength(160)
  key!: string;

  @IsString()
  @IsIn(['FEATURE', 'LIMIT', 'POLICY'])
  kind!: 'FEATURE' | 'LIMIT' | 'POLICY';

  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  domain!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/, { each: true })
  allowedPolicyValues?: string[];
}
