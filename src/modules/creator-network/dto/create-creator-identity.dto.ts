import {
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCreatorIdentityDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  providerCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalSubject: string;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  handle?: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  @IsOptional()
  profileUrl?: string;
}
