import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProductPlanDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  code: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;
}
