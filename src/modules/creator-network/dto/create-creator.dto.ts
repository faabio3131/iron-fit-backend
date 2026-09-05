import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCreatorDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MinLength(2)
  @MaxLength(80)
  slug: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  bio?: string;
}
